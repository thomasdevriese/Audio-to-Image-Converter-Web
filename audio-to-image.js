const A = require('arcsecond');
const B = require('arcsecond-binary');
const PNGReader = require('png.js');

async function convertToImage(audioBuffer, imageBuffer, addToExistingImage) {
  const riffChunkSize = B.u32LE.chain(size => {
    if (size !== audioBuffer.byteLength - 8) {
      return A.fail(`Invalid file size: ${audioBuffer.byteLength}. Expected ${size}`);
    }
    return A.succeedWith(size);
  });

  const riffChunk = A.sequenceOf([
    A.str('RIFF'),
    riffChunkSize,
    A.str('WAVE')
  ]);

  const fmtSubChunk = A.coroutine(function* () {
    const id = yield A.str('fmt ');
    const subChunk1Size = yield B.u32LE;
    const audioFormat = yield B.u16LE;
    const numChannels = yield B.u16LE;
    const sampleRate = yield B.u32LE;
    const byteRate = yield B.u32LE;
    const blockAlign = yield B.u16LE;
    const bitsPerSample = yield B.u16LE;

    const expectedByteRate = sampleRate * numChannels * bitsPerSample / 8;
    if (byteRate !== expectedByteRate) {
      yield A.fail(`Invalid byte rate: ${byteRate}, expected ${expectedByteRate}`);
    }

    const expectedBlockAlign = numChannels * bitsPerSample / 8;
    if (blockAlign !== expectedBlockAlign) {
      yield A.fail(`Invalid block align: ${blockAlign}, expected ${expectedBlockAlign}`);
    }

    const fmtChunkData = {
      id,
      subChunk1Size,
      audioFormat,
      numChannels,
      sampleRate,
      byteRate,
      blockAlign,
      bitsPerSample
    };

    yield A.setData(fmtChunkData);
    return fmtChunkData;
  });

  const dataSubChunk = A.coroutine(function* () {
    const id = yield A.str('data');
    const size = yield B.u32LE;

    const fmtData = yield A.getData;

    const samples = size / fmtData.numChannels / (fmtData.bitsPerSample / 8);
    const channelData = Array.from({length: fmtData.numChannels}, () => []);

    let sampleParser;
    if (fmtData.bitsPerSample === 8) {
      sampleParser = B.s8;
    } else if (fmtData.bitsPerSample === 16) {
      sampleParser = B.s16LE;
    } else if (fmtData.bitsPerSample === 32) {
      sampleParser = B.s32LE;
    } else {
      yield A.fail(`Unsupported bits per sample: ${fmtData.bitsPerSample}`);
    }

    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
      for (let i = 0; i < fmtData.numChannels; i++) {
        const sampleValue = yield sampleParser;
        channelData[i].push(sampleValue);
      }
    }

    return {
      id,
      size,
      samples,
      channelData
    };
  });

  const parser = A.sequenceOf([
    riffChunk,
    fmtSubChunk,
    dataSubChunk,
    // A.endOfInput
  ]).map(([riffChunk, fmtSubChunk, dataSubChunk]) => ({
    riffChunk,
    fmtSubChunk,
    dataSubChunk
  }));

  const output = parser.run(audioBuffer);
  if (output.isError) {
    throw new Error(output.error);
  }

  console.log(output.result);

  /*
  In sampleArray komen alle samples (dus opeenvolgende integers die de amplitude van de geluidsgolf voorstellen).
  Indien stereo: channelData[0] --> linkerkanaal, channelData[1] --> rechterkanaal.
  Indien mono: channelData[0] --> monokanaal.
  */
  let sampleArray = output.result.dataSubChunk.channelData;
  const audioFormat = output.result.fmtSubChunk.audioFormat;
  const numberOfChannels = output.result.fmtSubChunk.numChannels;
  const sampleRate = output.result.fmtSubChunk.sampleRate;
  const bitsPerSample = output.result.fmtSubChunk.bitsPerSample;

  if(numberOfChannels == 0 || numberOfChannels > 2){
    printErr("Unsupported number of channels.");
  }

  if(bitsPerSample != 16 && bitsPerSample != 32){
    printErr("Unsupported number of bits per sample.");
  }

  /*
  Controleren of audio mono of stereo is.
  */
  const stereo = numberOfChannels == 2 ? true : false;

  /*
  Eventuele stilte in begin van audio overslaan.
  */
  if(!stereo){
    let currentSample = sampleArray[0][0];
    while(currentSample == 0){
      sampleArray[0].shift();
      currentSample = sampleArray[0][0];
    }
  } else {
    let currentSampleLeft = sampleArray[0][0];
    let currentSampleRight = sampleArray[1][0];
    while(currentSampleLeft == 0 && currentSampleRight == 0){
      sampleArray[0].shift();
      sampleArray[1].shift();
      currentSampleLeft = sampleArray[0][0];
      currentSampleRight = sampleArray[1][0];
    }
  }

  const numberOfSamples = sampleArray[0].length;
  console.log(`Aantal samples (1 kanaal) na verwijderen initiële stilte: ${numberOfSamples} `);

  /*
  Eerste 3 values van linkerkanaal van sampleArray:
  */
  console.log(`Samples: ${sampleArray[0].slice(0,3)},...`);

  /*
  SampleArray omzetten naar / toevoegen aan afbeelding.
  */

  let numberOfEncodedLines = 0;
  let originalRGBA = [];
  let originalInt = [];
  let width = 0;
  let height = 0;

  if(addToExistingImage){
    const reader = new PNGReader(imageBuffer);
    let promise = new Promise((resolve, reject) => {
      reader.parse((err, png) => {
        if (err) throw err;
        /*
        Aantal geëncodeerde lijnen pixels berekenen om dan in header te steken, zodat bij het decoderen van de afbeelding enkel het geëncodeerde stuk bekeken wordt. De rest van de afbeelding moet gerust gelaten worden.
        */
        numberOfEncodedLines = Math.ceil((stereo ? 2 : 1) * numberOfSamples/png.getWidth());
        console.log(`Number of encoded lines: ${numberOfEncodedLines}`);
        /*
        Breedte van de nieuwe afbeelding zal zelfde zijn als die van de originele.
        Hoogte = hoogte van de originele afbeelding + aantal geëncodeerde lijnen + 1 (voor header).
        Bij stereo zijn er dubbel zoveel geëncodeerde lijnen in de afbeelding aangezien er voor het 2de kanaal nog eens evenveel lijnen moeten zijn.
        Zo bekomen we een rechthoekig geëncodeerd stuk met width*height aantal pixels, wat gelijk is aan het aantal samples.
        */
        width = png.getWidth();
        height = png.getHeight() + numberOfEncodedLines + 1;
        originalRGBA = png.getRGBA8Array();
        /*
        Loop over alle pixels, bereken 32-bit getal op basis van rgba waarden van pixel en steek getallen van hele lijn in rowData. RowData komt dan op zijn beurt in de 2-dimensionele array originalInt. De 32-bit getallen zijn nodig om mee te geven aan Jimp, die dan opnieuw een afbeelding zal samenstellen bestaande uit de data van de audiofile + de originalImageData.
        */
        let rowData = [];
        for (let y = 0; y < png.getHeight(); y++) {
          for (let x = 0; x < png.getWidth(); x++) {
            let index = (y * png.getWidth() + x) << 2;

            let r = originalRGBA[index] & 0xFF;
            let g = originalRGBA[index + 1] & 0xFF;
            let b = originalRGBA[index + 2] & 0xFF;
            let a = originalRGBA[index + 3] & 0xFF;

            /*
            Rgba waarden omvormen naar een unsigned 32-bit getal.
            */
            let rgba = (r << 24 >>> 0) + (g << 16) + (b << 8) + (a);

            rowData.push(rgba);
          }
          originalInt.push(rowData);
          rowData = [];
        }
        console.log(`Original image data (RGBA): ${originalRGBA.slice(0,3)},...`);
        console.log(`Original image data (int): ${originalInt[0].slice(0,3)},...`);
        resolve();
      });
    });
    await promise;
    return createImage(sampleArray, originalRGBA, originalInt, addToExistingImage, width, height, numberOfEncodedLines, numberOfChannels, stereo, bitsPerSample, sampleRate, audioFormat);
  } else {
    /*
    Width van de afbeelding is de vierkantswortel van het aantal samples, naar boven afgerond.
    Height is ofwel gelijk aan width (mono) ofwel 2*width (stereo) + 1 voor header.
    Bij stereo zijn er dubbel zoveel lijnen in de afbeelding aangezien er voor het 2de kanaal nog eens evenveel lijnen moeten zijn.
    Zo bekomen we een rechthoekige afbeelding met width*height aantal pixels, wat gelijk is aan het aantal samples.
    Er moet afgerond worden naar boven omdat die vierkantswortel meestal een kommagetal is, en je kan niet bv 300,21 pixels hebben.
    Dat betekent dus dat de laatste lijn pixels in de afbeelding meestal niet volledig opgevuld zal zijn met data.
    */
    width = Math.ceil(Math.sqrt(numberOfSamples));
    numberOfEncodedLines = (stereo ? 2*width : width);
    height = numberOfEncodedLines + 1;

    return createImage(sampleArray, originalRGBA, originalInt, addToExistingImage, width, height, numberOfEncodedLines, numberOfChannels, stereo, bitsPerSample, sampleRate, audioFormat);
  }
}

function createImage(sampleArray, originalRGBA, originalInt, addToExistingImage, width, height, numberOfEncodedLines, numberOfChannels, stereo, bitsPerSample, sampleRate, audioFormat){
  console.log(`Width: ${width}, height: ${height}`);
  let headerRGBA = createHeaderRGBA(width, numberOfEncodedLines, numberOfChannels, bitsPerSample, sampleRate, audioFormat);
  console.log(`Header (RGBA): ${headerRGBA.slice(0,20)},...`);
  let headerInt = createHeaderInt(width, numberOfEncodedLines, numberOfChannels, bitsPerSample, sampleRate, audioFormat);
  console.log(`Header (int): ${headerInt.slice(0,5)}`);

  /*
  ImageDataRGBA = array waarin header, amplitudes en originele image data opgeslagen zullen worden in RGBA-formaat.
  ImageDataInt = array waarin header, amplitudes en originele image data opgeslagen zullen worden in unsigned 32-bit int formaat.
  */
  let imageDataRGBA = [];
  imageDataRGBA.push(...headerRGBA);
  let imageDataInt = [];
  imageDataInt.push(headerInt);
  /*
  RowData = data voor 1 rij in de afbeelding.
  */
  let rowDataRGBA = [];
  let rowDataInt = [];
  /*
  De afbeelding pixel per pixel berekenen in een loop.
  */
  let channel = 0;
  for(let y = 0; y < numberOfEncodedLines; y++) {
    if(stereo){
      channel = y%2;
    }
    for(let x = 0; x < width; x++) {
      /*
      Positie in sampleArray gebaseerd op x en y + controleren als het stereo is en voor welk kanaal we bezig zijn.
      */
      let posSampleArray = (stereo ? (channel ? (y-1)/2 : y/2) : y) * width + x;
      /*
      Amplitude herleiden naar waarde tussen 0 en 65535 (unsigned 16-bit getal) of tussen 0 en 4294967295 (unsigned 32-bit getal) door op te tellen met de helft van 65536 = 32768 of met de helft van 4294967296 = 2147483648.
      */
      let amplitude = sampleArray[channel][posSampleArray] + (bitsPerSample == 16 ? 32768 : 2147483648);
      rowDataInt.push(amplitude);
      let rgba = intToRGBA(amplitude);
      rowDataRGBA.push(...rgba);
    }
    if(rowDataRGBA.length != width * 4){
      let l = rowDataRGBA.length;
      rowDataRGBA.length = width * 4;
      rowDataRGBA.fill(0,l,rowDataRGBA.length);
    }
    imageDataRGBA.push(...rowDataRGBA);
    rowDataRGBA = [];
    imageDataInt.push(rowDataInt);
    rowDataInt = [];
  }

  if(addToExistingImage){
    imageDataRGBA = imageDataRGBA.concat(originalRGBA);
    imageDataInt = imageDataInt.concat(originalInt);
  }

  console.log(`\n${stereo ? 'Stereo' : 'Mono'} audio converted to image`);

  return {
    imageDataRGBA,
    imageDataInt,
    width,
    height
  };
}

function createHeaderRGBA(width, numberOfEncodedLines, numberOfChannels, bitsPerSample, sampleRate, audioFormat){
  let header = new Array(width * 4);
  header.splice(0,4,...intToRGBA(numberOfEncodedLines));
  header.splice(4,4,...intToRGBA(numberOfChannels));
  header.splice(8,4,...intToRGBA(bitsPerSample));
  header.splice(12,4,...intToRGBA(sampleRate));
  header.splice(16,4,...intToRGBA(audioFormat));
  header.fill(0,20,width*4);
  return header;
}

function createHeaderInt(width, numberOfEncodedLines, numberOfChannels, bitsPerSample, sampleRate, audioFormat){
  let header = new Uint32Array(width);
  header[0] = numberOfEncodedLines;
  header[1] = numberOfChannels;
  header[2] = bitsPerSample;
  header[3] = sampleRate;
  header[4] = audioFormat;

  return header;
}

function intToRGBA(number) {
  const r = (number >> 24) & 0xFF;
  const g = (number >> 16) & 0xFF;
  const b = (number >> 8) & 0xFF;
  const a = number & 0xFF;

  return [r,g,b,a];
}

function printErr(msg) {
  alert(msg);
  throw new Error(msg);
}

module.exports.convertToImage = convertToImage;
