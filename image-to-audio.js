const C = require('construct-js');
const PNGReader = require('png.js');

async function convertToAudio(imageBuffer){
  let numberOfEncodedLines, numberOfChannels, stereo, bitsPerSample, sampleRate, audioFormat;
  let soundData = [];

  const reader = new PNGReader(imageBuffer);
  let promise = new Promise((resolve, reject) => {
    reader.parse((err,png) => {
      if (err) throw err;
      let imageDataRGBA = png.getRGBA8Array();
      /*
      Header (eerste lijn uit afbeelding) parsen. Enkel eerste 5 pixels zijn nodig (dus 20 rgba waarden).
      */
      numberOfEncodedLines = RGBAToInt(imageDataRGBA.slice(0,4));
      numberOfChannels = RGBAToInt(imageDataRGBA.slice(4,8));
      bitsPerSample = RGBAToInt(imageDataRGBA.slice(8,12));
      sampleRate = RGBAToInt(imageDataRGBA.slice(12,16));
      audioFormat = RGBAToInt(imageDataRGBA.slice(16,20));
      if((numberOfChannels < 1 || numberOfChannels > 2) || (bitsPerSample != 16 && bitsPerSample != 32) || (audioFormat != 1 && audioFormat != 3)){
        printErr('Error: invalid data. Use a correctly encoded image.');
      }
      console.log(`Header: ${numberOfEncodedLines},${numberOfChannels},${bitsPerSample},${sampleRate},${audioFormat}`);

      /*
      Controleren op stereo.
      */
      stereo = numberOfChannels == 2 ? true : false;
      /*
      Loop over alle pixels, bereken amplitude op basis van rgba waarden van pixel en steek amplitude in array soundData.
      Beginnen bij y = 1 want eerste lijn is header.
      */
      for (let y = 1; y <= numberOfEncodedLines; (stereo ? y+=2 : y++)) {
        for (let x = 0; x < png.getWidth(); x++) {
          let index = (y * png.getWidth() + x) << 2;

          let r = imageDataRGBA[index] & 0xFF;
          let g = imageDataRGBA[index + 1] & 0xFF;
          let b = imageDataRGBA[index + 2] & 0xFF;
          let a = imageDataRGBA[index + 3] & 0xFF;

          /*
          RGBA waarden omvormen naar een unsigned 16-bit of 32-bit getal.
          */
          let rgba;
          if(bitsPerSample == 16){
            rgba = (b << 8 >>> 0) + (a);
          } else {
            rgba = (r << 24 >>> 0) + (g << 16) + (b << 8) + (a);
          }
          /*
          Terug herleiden naar getal tussen -32768 en 32768 (signed 16-bit getal) of tussen -2147483648 en 2147483647 (signed 32-bit getal), om amplitude van geluidsgolf voor te stellen.
          */
          let amplitude = rgba - (bitsPerSample == 16 ? 32768 : 2147483648);
          soundData.push(amplitude);

          /*
          In een stereo wav bestand worden de samples van de 2 kanalen samengevoegd in een eendimensionele array.
          Daarin zijn de samples afwisselend van kanaal 1 en kanaal 2.
          */
          if(stereo){
            let index2 = ((y+1) * png.getWidth() + x) << 2;

            let r2 = imageDataRGBA[index2] & 0xFF;
            let g2 = imageDataRGBA[index2 + 1] & 0xFF;
            let b2 = imageDataRGBA[index2 + 2] & 0xFF;
            let a2 = imageDataRGBA[index2 + 3] & 0xFF;
            let rgba2;
            if(bitsPerSample == 16){
              rgba2 = (b2 << 8 >>> 0) + (a2);
            } else {
              rgba2 = (r2 << 24 >>> 0) + (g2 << 16) + (b2 << 8) + (a2);
            }
            let amplitude2 = rgba2 - (bitsPerSample == 16 ? 32768 : 2147483648);
            soundData.push(amplitude2);
          }
        }
      }
      console.log(`Samples: ${soundData.slice(0,stereo ? 6 : 3)},...`);

      /*
      Zou moeten gelijk zijn aan Math.Ceil(Math.sqrt(<origineel-aantal-samples>))².
      */
      console.log(`Aantal samples (1 kanaal): ${stereo ? soundData.length/2 : soundData.length}`);
      
      resolve();
    });
  });
  await promise;
  return createWav(soundData, stereo, numberOfChannels, bitsPerSample, sampleRate, audioFormat);
}

function createWav(soundData, stereo, numberOfChannels, bitsPerSample, sampleRate, audioFormat){
  const riffChunkStruct = C.Struct('riffChunk')
    .field('magic', C.RawString('RIFF'))
    .field('size', C.U32LE(0))
    .field('fmtName', C.RawString('WAVE'));

  const fmtSubChunkStruct = C.Struct('fmtSubChunk')
    .field('id', C.RawString('fmt '))
    .field('subChunk1Size', C.U32LE(0))
    .field('audioFormat', C.U16LE(audioFormat))
    .field('numChannels', C.U16LE(numberOfChannels))
    .field('sampleRate', C.U32LE(sampleRate))
    .field('byteRate', C.U32LE(sampleRate * numberOfChannels * bitsPerSample/8))
    .field('blockAlign', C.U16LE(numberOfChannels * bitsPerSample/8))
    .field('bitsPerSample', C.U16LE(bitsPerSample));
  const totalSubChunkSize = fmtSubChunkStruct.computeBufferSize();
  fmtSubChunkStruct.get('subChunk1Size').set(totalSubChunkSize - 8);

  const dataSubChunkStruct = C.Struct('dataSubChunk')
    .field('id', C.RawString('data'))
    .field('size', C.U32LE(0))
    .field('data', bitsPerSample == 16 ? C.S16LEs([0]) : C.S32LEs([0]));

  dataSubChunkStruct.get('data').set(soundData);
  /*
  Je hoeft hier niet te controleren op aantal channels, een stereo soundData array is sowieso al dubbel zo groot.
  */
  dataSubChunkStruct.get('size').set(soundData.length * bitsPerSample/8);
  riffChunkStruct.get('size').set(36 + dataSubChunkStruct.get('size').raw[0]);

  const fileStruct = C.Struct('waveFile')
    .field('riffChunk', riffChunkStruct)
    .field('fmtSubChunk', fmtSubChunkStruct)
    .field('dataSubChunk', dataSubChunkStruct);

  console.log(`\nImage converted to ${stereo ? 'stereo' : 'mono'} audio`);

  return fileStruct.toBuffer();
}

function RGBAToInt(rgba) {
  let r = rgba[0] & 0xFF;
  let g = rgba[1] & 0xFF;
  let b = rgba[2] & 0xFF;
  let a = rgba[3] & 0xFF;

  return ((r << 24 >>> 0) + (g << 16) + (b << 8) + (a));
}

function printErr(msg) {
  alert(msg);
  throw new Error(msg);
}

module.exports.convertToAudio = convertToAudio;
