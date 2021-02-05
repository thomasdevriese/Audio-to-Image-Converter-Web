const Jimp = require('jimp');
const PNGReader = require('png.js');
const {Howl, Howler} = require('howler');
const AudioToImage = require('./audio-to-image.js');
const ImageToAudio = require('./image-to-audio.js');

let filename;
let filenameReverse;
let audioBuffer;
let imageBuffer;
let imageReverseBuffer;
let addToExistingImage = false;
let audio;

window.addEventListener('DOMContentLoaded', (event) => {
  init();
});

function init() {
  document.getElementById("btn-convert-to-image").addEventListener("click", convertToImage);
  document.getElementById("btn-convert-to-audio").addEventListener("click", convertToAudio);
  document.getElementById("btn-toggle-audio").addEventListener("click", toggleAudio);
  document.getElementById("btn-stop-audio").addEventListener("click", stopAudio);
  let audioInput = document.getElementById("audio-input");
  let imageInput = document.getElementById("image-input");
  let imageReverseInput = document.getElementById("image-input-reverse");
  audioInput.onchange = e => { 
    const file = e.target.files[0];
    const regexWAV = /^(?:[\w-() ]+\/)*([\w-() ]+)\.wav$/i;
    const matchesWAV = file.name.match(regexWAV);
    if(!matchesWAV){
      printErr("Incorrect file! Must be a WAVE file.");
    } else {
      filename = matchesWAV[1];
      const reader = new FileReader();
      reader.readAsArrayBuffer(file);
      reader.onload = readerEvent => {
        audioBuffer = readerEvent.target.result;
      }
    }
  }
  imageInput.onchange = e => { 
    const file = e.target.files[0];
    const regexImg = /^(?:[\w-() ]+\/)*([\w-() ]+)\.(png|jpg)$/i;
    const matchesImg = file.name.match(regexImg);
    if(!matchesImg){
      addToExistingImage = false;
      printErr("Incorrect file! Must be an image.");
    } else {
      addToExistingImage = true;
      let extension = matchesImg[2];
      const reader = new FileReader();
      if(extension == "png"){
        reader.readAsArrayBuffer(file);
        reader.onload = readerEvent => {
          imageBuffer = readerEvent.target.result;
        }
      } else if (extension == "jpg"){
        // convert image to png
        reader.readAsDataURL(file);
        reader.onload = readerEvent => {
          let image = new Image();
          image.src = readerEvent.target.result;
          let canvas = document.createElement("canvas");
          let ctx = canvas.getContext('2d');
          image.addEventListener('load', function() {
            canvas.width = image.width;
            canvas.height = image.height;
            ctx.drawImage(image, 0, 0);
            let dataUrl = canvas.toDataURL("image/png");
            imageBuffer = dataUrlToArrayBuffer(dataUrl);
          }, false);
        }
      }
    }
  }
  imageReverseInput.onchange = e => { 
    const file = e.target.files[0];
    const regexPNG = /^(?:[\w-() ]+\/)*([\w-() ]+)\.png$/i;
    const matchesPNG = file.name.match(regexPNG);
    if(!matchesPNG){
      printErr("Incorrect file! Must be a PNG file.");
    } else {
      filenameReverse = matchesPNG[1].slice(-8) == '_encoded' ? matchesPNG[1].slice(0,-8) : matchesPNG[1];
      const reader = new FileReader();
      reader.readAsArrayBuffer(file);
      reader.onload = readerEvent => {
        imageReverseBuffer = readerEvent.target.result;
        let canvasReverse = document.getElementById("canvas-reverse");
        let ctxReverse = canvasReverse.getContext('2d');
        const reader = new PNGReader(imageReverseBuffer);
        reader.parse((err,png) => {
          if (err) throw err;
          canvasReverse.width = png.getWidth();
          canvasReverse.height = png.getHeight();
          let idata = ctxReverse.createImageData(png.getWidth(), png.getHeight());
          idata.data.set(png.getRGBA8Array());
          ctxReverse.putImageData(idata, 0, 0);
        });
      }
    }
  }
}

function convertToImage() {
  if(audioBuffer){
    let canvas = document.getElementById('canvas');
    let ctx = canvas.getContext('2d');
    AudioToImage.convertToImage(audioBuffer, imageBuffer, addToExistingImage).then((imageObj) => {
      console.log(imageObj);
      canvas.width = imageObj.width;
      canvas.height = imageObj.height;
      let idata = ctx.createImageData(imageObj.width, imageObj.height);
      idata.data.set(imageObj.imageDataRGBA);
      ctx.putImageData(idata, 0, 0);

      let downloadMessage = document.getElementById("download-message");
      downloadMessage.style.display = "block";
      
      let image = new Jimp(imageObj.width, imageObj.height, (err, image) => {
        if (err) throw err;
    
        imageObj.imageDataInt.forEach((row, y) => {
          row.forEach((color, x) => {
            image.setPixelColor(color, x, y);
          });
        });  
        
        image.getBase64(Jimp.MIME_PNG, (err, base64) => {
          if (err) throw err;
          let downloadLink = document.getElementById("download-link");
          downloadLink.href = base64;
          downloadLink.download = `${filename}_encoded.png`;
        });
      });
    })
    .catch((err) => {
      throw err;
    });
  } else {
    printErr("Please choose a file first.");
  }
}

function convertToAudio() {
  if(imageReverseBuffer){
    ImageToAudio.convertToAudio(imageReverseBuffer).then((wavByteArray) => {
      let btnToggleAudio = document.getElementById("btn-toggle-audio");
      let btnStopAudio = document.getElementById("btn-stop-audio");
      let divAudioButtons = document.getElementById("div-audio-buttons");
      let downloadLinkAudio = document.getElementById("download-link-audio");
      let base64 = "data:audio/x-wav;base64," + wavByteArray.toString("base64");
      audio = new Howl({
        src: [base64],
        format: ['wav'],
        onload: function() {
          divAudioButtons.style.display = "flex";
          downloadLinkAudio.href = base64;
          downloadLinkAudio.download = `${filenameReverse}.wav`;
          downloadLinkAudio.innerHTML = `Download ${filenameReverse}.wav`;
          downloadLinkAudio.style.display = "block";
        },
        onplay: function() {
          btnToggleAudio.innerHTML = "Pause";
        },
        onpause: function() {
          btnToggleAudio.innerHTML = "Play";
        },
        onstop: function() {
          btnToggleAudio.innerHTML = "Play";
        },
        onend: function() {
          btnToggleAudio.innerHTML = "Play";
        }
      });
    }).catch((err) => {
      throw err;
    });
  } else {
    printErr("Please choose a file first.");
  }
}

function toggleAudio() {
  if(audio.playing()){
    audio.pause();
  } else {
    audio.play();
  }
}

function stopAudio() {
  audio.stop();
}

function dataUrlToArrayBuffer(dataUrl) {
  let base64 = dataUrl.replace(/^data:image\/(png|jpg);base64,/, "");
  let binary_string = window.atob(base64);
  let len = binary_string.length;
  let bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function printErr(msg) {
  alert(msg);
  throw new Error(msg);
}