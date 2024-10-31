// Constants
const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB for splitting and uploading
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WAIT_TIME_BETWEEN_CHUNKS = 1000; // 1 second wait between each chunk upload

// State Management
let state = {
   isProcessing: false,
   transcriptionText: '',
   transcriptionSRT: '',
   currentOffset: 0,
   segments: [],
   currentFormat: 'text' // Default format
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
   initializeUI();
   setupEventListeners();
});

function initializeUI() {
   const apiKey = localStorage.getItem('groqApiKey');
   document.getElementById('apiRequest').style.display = apiKey ? 'none' : 'block';
   document.getElementById('startProcessBtn').style.display = apiKey ? 'block' : 'none';
   
   // Initialize tabs
   document.getElementById('textTab').style.display = 'block';
   document.getElementById('srtTab').style.display = 'none';
}

function setupEventListeners() {
   const fileInput = document.getElementById('audioFile');
   fileInput.addEventListener('change', handleFileSelection);

   // Add tab change listeners
   document.querySelectorAll('.tablinks').forEach(tab => {
       tab.addEventListener('click', (event) => {
           state.currentFormat = event.currentTarget.getAttribute('data-format');
       });
   });
}

// File Handling
function handleFileSelection(event) {
   const file = event.target.files[0];
   const fileName = file ? file.name : "לא נבחר קובץ";
   document.getElementById('fileName').textContent = fileName;
   document.getElementById('uploadBtn').disabled = !file;
   
   logDebug('FILE_SELECTED', `File selected by user`, {
       name: fileName,
       size: file?.size,
       type: file?.type
   });
}

function triggerFileUpload() {
   if (!state.isProcessing) {
       document.getElementById('audioFile').click();
   }
}

// Audio Processing Functions
async function splitAudioFile(file) {
   logDebug('FILE_SPLIT', `Starting to split file: ${file.name}`, {
       size: file.size,
       type: file.type
   });

   try {
       const audioContext = new (window.AudioContext || window.webkitAudioContext)();
       const arrayBuffer = await file.arrayBuffer();
       const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

       const sampleRate = audioBuffer.sampleRate;
       const numChannels = audioBuffer.numberOfChannels;
       const chunkDuration = MAX_CHUNK_SIZE / (sampleRate * numChannels * 2);
       let currentTime = 0;
       const chunks = [];

       updateProgress(5); // Initial progress
       showMessage(`מתחיל בעיבוד הקובץ...`);

       while (currentTime < audioBuffer.duration) {
           const end = Math.min(currentTime + chunkDuration, audioBuffer.duration);
           const frameCount = Math.floor((end - currentTime) * sampleRate);

           const chunkBuffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

           for (let channel = 0; channel < numChannels; channel++) {
               const originalChannelData = audioBuffer.getChannelData(channel);
               const chunkChannelData = chunkBuffer.getChannelData(channel);

               for (let i = 0; i < frameCount; i++) {
                   chunkChannelData[i] = originalChannelData[Math.floor(currentTime * sampleRate) + i];
               }
           }

           const blob = bufferToWaveBlob(chunkBuffer);
           chunks.push(new File([blob], `chunk_${chunks.length + 1}.wav`, { type: 'audio/wav' }));
           
           logDebug('CHUNK_CREATED', `Created chunk ${chunks.length}`, {
               chunkSize: blob.size,
               currentTime: currentTime,
               endTime: end
           });

           currentTime = end;
       }

       logDebug('CHUNKS_CREATED', `File split complete`, {
           numberOfChunks: chunks.length
       });

       return chunks;
   } catch (error) {
       logDebug('SPLIT_ERROR', `Error splitting file`, { error: error.message });
       throw error;
   }
}

function bufferToWaveBlob(audioBuffer) {
   const numOfChan = audioBuffer.numberOfChannels;
   const length = audioBuffer.length * numOfChan * 2 + 44;
   const buffer = new ArrayBuffer(length);
   const view = new DataView(buffer);
   const channels = [];
   let offset = 0;
   let pos = 0;

   // Write WAV header
   function setUint16(data) {
       view.setUint16(pos, data, true);
       pos += 2;
   }

   function setUint32(data) {
       view.setUint32(pos, data, true);
       pos += 4;
   }

   setUint32(0x46464952); // "RIFF"
   setUint32(length - 8); // file length - 8
   setUint32(0x45564157); // "WAVE"
   setUint32(0x20746d66); // "fmt " chunk
   setUint32(16); // length = 16
   setUint16(1); // PCM (uncompressed)
   setUint16(numOfChan);
   setUint32(audioBuffer.sampleRate);
   setUint32(audioBuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
   setUint16(numOfChan * 2); // block-align
   setUint16(16); // 16-bit
   setUint32(0x61746164); // "data" chunk
   setUint32(length - pos - 4); // chunk length

   // Write audio data
   for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
       channels.push(audioBuffer.getChannelData(i));
   }

   while (pos < length) {
       for (let i = 0; i < numOfChan; i++) {
           const sample = Math.max(-1, Math.min(1, channels[i][offset]));
           view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
           pos += 2;
       }
       offset++;
   }

   return new Blob([buffer], { type: "audio/wav" });
}

// API Communication
async function transcribeChunk(chunk, apiKey) {
   logDebug('TRANSCRIBE_START', `Starting transcription for chunk: ${chunk.name}`, {
       chunkSize: chunk.size,
       chunkType: chunk.type
   });

   const formData = new FormData();
   formData.append('file', chunk);
   formData.append('model', 'whisper-large-v3-turbo');
   formData.append('response_format', 'verbose_json');
   formData.append('language', 'he');

   try {
       const response = await fetch(API_URL, {
           method: 'POST',
           headers: {
               'Authorization': `Bearer ${apiKey}`
           },
           body: formData
       });

       if (!response.ok) {
           const errorText = await response.text();
           logDebug('API_ERROR', `API returned error`, {
               status: response.status,
               errorText: errorText
           });
           throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
       }

       const result = await response.json();
       logDebug('TRANSCRIBE_SUCCESS', `Successfully transcribed chunk`, {
           textLength: result.text?.length || 0
       });
       return result;

   } catch (error) {
       logDebug('TRANSCRIBE_ERROR', `Error during transcription`, {
           error: error.message
       });
       throw error;
   }
}

// Main Processing
async function uploadAudio() {
   if (state.isProcessing) return;

   const apiKey = localStorage.getItem('groqApiKey');
   const file = document.getElementById('audioFile').files[0];

   logDebug('UPLOAD_START', `Starting upload process`, {
       fileName: file?.name,
       fileSize: file?.size,
       fileType: file?.type
   });

   if (!apiKey || !file) {
       logDebug('VALIDATION_ERROR', `Missing API key or file`);
       alert(!apiKey ? 'מפתח API חסר. נא להזין מחדש.' : 'אנא בחר קובץ להעלאה.');
       return;
   }

   state.isProcessing = true;
   resetState();
   openModal('modal3');

   try {
       const chunks = await splitAudioFile(file);
       
       for (let i = 0; i < chunks.length; i++) {
           const chunkProgress = (i / chunks.length) * 80; // 80% for processing chunks
           updateProgress(10 + chunkProgress); // 10% initial + chunk progress
           
           showMessage(`מתמלל חלק ${i + 1} מתוך ${chunks.length}...`);
           
           const result = await transcribeChunk(chunks[i], apiKey);
           
           if (result.text) {
               state.transcriptionText += result.text + ' ';
               if (result.segments) {
                   const adjustedSegments = adjustSegmentTimings(result.segments, i, chunks.length);
                   state.segments.push(...adjustedSegments);
               }
           }

           await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_CHUNKS));
       }

       state.transcriptionText = state.transcriptionText.trim();
       logDebug('PROCESS_COMPLETE', `Transcription complete`, {
           finalTextLength: state.transcriptionText.length,
           numberOfSegments: state.segments.length
       });
       
       updateProgress(100);
       showResults();

   } catch (error) {
       logDebug('PROCESS_ERROR', `Error in upload process`, {
           error: error.message
       });
       console.error('Processing error:', error);
       handleError(error);
   } finally {
       state.isProcessing = false;
       closeModal('modal3');
   }
}

function adjustSegmentTimings(segments, chunkIndex, totalChunks) {
   const chunkDuration = 30; // Approximate chunk duration in seconds
   const timeOffset = chunkIndex * chunkDuration;
   
   return segments.map(segment => ({
       ...segment,
       start: segment.start + timeOffset,
       end: segment.end + timeOffset
   }));
}

// UI Functions
function showMessage(message, duration = 3000) {
   const messageElement = document.createElement('div');
   messageElement.textContent = message;
   messageElement.style.position = 'fixed';
   messageElement.style.top = '20px';
   messageElement.style.left = '50%';
   messageElement.style.transform = 'translateX(-50%)';
   messageElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
   messageElement.style.color = 'white';
   messageElement.style.padding = '10px 20px';
   messageElement.style.borderRadius = '5px';
   messageElement.style.zIndex = '1000';
   
   document.body.appendChild(messageElement);
   if (duration > 0) {
       setTimeout(() => document.body.removeChild(messageElement), duration);
   }
   return messageElement;
}

// Modal Management
function openModal(modalId) {
   const modal = document.getElementById(modalId);
   if (modal) {
       modal.style.display = 'block';
       document.body.classList.add('modal-open');
   }
}

function closeModal(modalId) {
   const modal = document.getElementById(modalId);
   if (modal) {
       modal.style.display = 'none';
       document.body.classList.remove('modal-open');
   }
}

function updateProgress(percent) {
   document.getElementById('progress').style.width = `${percent}%`;
   document.getElementById('progressText').textContent = `${Math.round(percent)}%`;
}

function handleError(error) {
   console.error('Error details:', error);
   if (error.message.includes('401')) {
       alert('שגיאה במפתח API. נא להזין מפתח חדש.');
       localStorage.removeItem('groqApiKey');
       location.reload();
   } else {
       alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
   }
}

// Tab Management
function openTab(evt, tabName) {
   document.querySelectorAll('.tabcontent').forEach(tab => {
       tab.style.display = 'none';
       tab.classList.remove('active');
   });

   document.querySelectorAll('.tablinks').forEach(button => 
       button.classList.remove('active'));

   const selectedContent = document.getElementById(tabName);
   if (selectedContent) {
       selectedContent.style.display = 'block';
       selectedContent.classList.add('active');
   }

   if (evt && evt.currentTarget) {
       evt.currentTarget.classList.add('active');
       state.currentFormat = evt.currentTarget.getAttribute('data-format');
   }
}

// Results and Download Functions
function showResults() {
   openModal('modal4');
   const textContent = document.getElementById('textContent');
   const srtContent = document.getElementById('srtContent');
   
   if (textContent) textContent.textContent = state.transcriptionText;
   if (srtContent) srtContent.textContent = generateSRTContent();
   
   openTab(null, 'textTab');
}

function generateSRTContent() {
   if (!state.segments || state.segments.length === 0) {
       return state.transcriptionText;
   }

   let srtContent = '';
   state.segments.forEach((segment, index) => {
       const start = formatTimestamp(segment.start);
       const end = formatTimestamp(segment.end);
       srtContent += `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
   });
   
   return srtContent;
}

function downloadTranscription() {
   const format = state.currentFormat;
   const content = format === 'text' ? state.transcriptionText : generateSRTContent();
   const fileExtension = format === 'text' ? 'txt' : 'srt';
   const fileName = `transcription_${new Date().toISOString()}.${fileExtension}`;
   
   logDebug('DOWNLOAD_START', `Starting download`, {
       format: format,
       fileName: fileName
   });

   const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const link = document.createElement('a');
   link.href = url;
   link.download = fileName;
   
   document.body.appendChild(link);
   link.click();
   document.body.removeChild(link);
   URL.revokeObjectURL(url);
   
   showMessage('הקובץ הורד בהצלחה!');
   logDebug('DOWNLOAD_COMPLETE', `File download completed`);
}

function formatTimestamp(seconds) {
   if (typeof seconds !== 'number' || isNaN(seconds)) {
       return '00:00:00,000';
   }
   
   const date = new Date(seconds * 1000);
   return [
       String(date.getUTCHours()).padStart(2, '0'),
       String(date.getUTCMinutes()).padStart(2, '0'),
       String(date.getUTCSeconds()).padStart(2, '0')
   ].join(':') + ',' + String(date.getUTCMilliseconds()).padStart(3, '0');
}

// State Management Functions
function resetState() {
   state = {
       isProcessing: state.isProcessing,
       transcriptionText: '',
       transcriptionSRT: '',
       currentOffset: 0,
       segments: [],
       currentFormat: 'text'
   };
   updateProgress(0);
}

function restartProcess() {
   if (!state.isProcessing) {
       closeModal('modal4');
       document.getElementById('audioFile').value = '';
       document.getElementById('fileName').textContent = 'לא נבחר קובץ';
       document.getElementById('uploadBtn').disabled = true;
       openModal('modal1');
       resetState();
   }
}

// API Key Management
function saveApiKey() {
   const apiKey = document.getElementById('apiKeyInput').value.trim();
   if (apiKey) {
       localStorage.setItem('groqApiKey', apiKey);
       document.getElementById('apiRequest').style.display = 'none';
       document.getElementById('startProcessBtn').style.display = 'block';
       logDebug('API_KEY_SAVED', 'API key saved successfully');
   }
}

// Debug Logger
function logDebug(stage, message, data = null) {
   const timestamp = new Date().toISOString();
   console.log(`[${timestamp}] [${stage}] ${message}`);
   if (data) {
       console.log('Data:', data);
   }
}
