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

// Debug Logger
function logDebug(stage, message, data = null) {
   const timestamp = new Date().toISOString();
   console.log(`[${timestamp}] [${stage}] ${message}`);
   if (data) {
       console.log('Data:', data);
   }
}

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

async function splitAudioFile(file) {
   logDebug('FILE_SPLIT', `Starting to process file: ${file.name}`, {
       size: file.size,
       type: file.type
   });

   // אם הקובץ קטן מ-24MB, נחזיר אותו כמו שהוא
   if (file.size <= MAX_CHUNK_SIZE) {
       logDebug('FILE_PROCESS', 'File is smaller than 24MB, no splitting needed');
       return [file];
   }

   // עבור קבצים גדולים, נבצע חלוקה
   const chunks = Math.ceil(file.size / MAX_CHUNK_SIZE);
   const audioChunks = [];

   for (let i = 0; i < chunks; i++) {
       const start = i * MAX_CHUNK_SIZE;
       const end = Math.min((i + 1) * MAX_CHUNK_SIZE, file.size);
       const chunk = file.slice(start, end);
       
       const chunkFile = new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, { 
           type: file.type
       });
       
       audioChunks.push(chunkFile);
       
       logDebug('CHUNK_CREATED', `Created chunk ${i + 1}/${chunks}`, {
           chunkSize: chunkFile.size,
           chunkName: chunkFile.name,
           chunkType: chunkFile.type
       });
   }

   logDebug('CHUNKS_CREATED', `Split complete: created ${chunks} chunks`);
   return audioChunks;
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
   updateProgress(0);

   try {
       const chunks = await splitAudioFile(file);
       updateProgress(10);

       if (chunks.length > 1) {
           showMessage(`מתחיל בתמלול ${chunks.length} מקטעים...`);
           
           for (let i = 0; i < chunks.length; i++) {
               const progressPercent = (i / chunks.length) * 90;
               updateProgress(10 + progressPercent);
               
               showMessage(`מתמלל מקטע ${i + 1} מתוך ${chunks.length}`);
               
               const result = await transcribeChunk(chunks[i], apiKey);
               if (result.text) {
                   state.transcriptionText += result.text + ' ';
                   if (result.segments) {
                       const adjustedSegments = adjustSegmentTimings(result.segments, i, chunks.length);
                       state.segments.push(...adjustedSegments);
                   }
               }

               if (i < chunks.length - 1) {
                   await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_CHUNKS));
               }
           }
       } else {
           showMessage(`מתמלל את הקובץ...`);
           const result = await transcribeChunk(chunks[0], apiKey);
           if (result.text) {
               state.transcriptionText = result.text;
               if (result.segments) {
                   state.segments = result.segments;
               }
           }
           updateProgress(90);
       }

       state.transcriptionText = state.transcriptionText.trim();
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
   const chunkDuration = 30;
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

// Results and Download
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

// State Reset and API Key
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

function saveApiKey() {
   const apiKey = document.getElementById('apiKeyInput').value.trim();
   if (apiKey) {
       localStorage.setItem('groqApiKey', apiKey);
       document.getElementById('apiRequest').style.display = 'none';
       document.getElementById('startProcessBtn').style.display = 'block';
       logDebug('API_KEY_SAVED', 'API key saved successfully');
   }
}
