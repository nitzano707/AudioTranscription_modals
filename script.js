// Constants
const MAX_CHUNK_SIZE = 5 * 1024 * 1024;  // 5MB
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const FILE_TYPES = {
   'audio/wav': { extension: 'wav', contentType: 'audio/wav' },
   'audio/mpeg': { extension: 'mp3', contentType: 'audio/mpeg' },
   'video/mp4': { extension: 'mp4', contentType: 'video/mp4' },
   'audio/x-m4a': { extension: 'm4a', contentType: 'audio/m4a' }
};

// State Management
const state = {
   processing: {
       isActive: false,
       startTime: null,
       processedChunks: 0,
       totalChunks: 0
   },
   transcription: {
       text: '',
       segments: [],
       format: 'text'
   }
};

// Debug Logger
const logger = {
   debug(stage, message, data = null) {
       const timestamp = new Date().toISOString();
       console.log(`[${timestamp}] [${stage}] ${message}`);
       if (data) console.log('Data:', data);
   }
};

// Core Initialization
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
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelection);
    } else {
        logger.debug('ERROR', 'audioFile element not found in the DOM.');
    }

    document.querySelectorAll('.tablinks').forEach(tab => {
        tab.addEventListener('click', (e) => openTab(e, e.currentTarget.dataset.format));
    });

    document.getElementById('uploadBtn').addEventListener('click', uploadAudio);
    document.getElementById('startProcessBtn').addEventListener('click', () => openModal('modal1'));
    document.getElementById('restartProcessBtn').addEventListener('click', restartProcess);
    document.getElementById('downloadTranscriptionBtn').addEventListener('click', downloadTranscription);
}

// File Management
function triggerFileUpload() {
   if (!state.processing.isActive) {
       document.getElementById('audioFile').click();
   }
}

function handleFileSelection(event) {
   const file = event.target.files[0];
   if (!file) {
       logger.debug('ERROR', 'No file selected.');
       return;
   }

   const fileName = file.name;
   document.getElementById('fileName').textContent = fileName;
   document.getElementById('uploadBtn').disabled = !file;

   logger.debug('FILE_SELECTED', `Selected file: ${fileName}`, {
       size: file.size,
       type: file.type
   });
}

// Audio Processing
async function splitAudioFile(file) {
   const chunkSize = MAX_CHUNK_SIZE;
   const chunks = Math.ceil(file.size / chunkSize);
   const audioChunks = [];

   for (let i = 0; i < chunks; i++) {
       const start = i * chunkSize;
       const end = Math.min((i + 1) * chunkSize, file.size);

       const chunk = file.slice(start, end);
       const chunkFile = new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, {
           type: file.type
       });

       audioChunks.push(chunkFile);

       logger.debug('CHUNK_CREATED', `Created chunk ${i + 1}/${chunks}`, {
           chunkSize: chunkFile.size,
           chunkType: chunkFile.type,
           chunkName: chunkFile.name
       });
   }

   logger.debug('SPLIT_AUDIO_COMPLETE', `Completed splitting audio file into ${audioChunks.length} chunks`, {
       totalChunks: audioChunks.length
   });

   return audioChunks;
}

// API Communication
async function transcribeChunk(chunk, apiKey) {
   const formData = new FormData();
   formData.append('file', chunk, chunk.name);
   formData.append('model', 'whisper-large-v3-turbo');
   formData.append('response_format', 'verbose_json');
   formData.append('language', 'he');

   logger.debug('TRANSCRIBE_REQUEST', 'Sending transcription request for chunk', {
       chunkName: chunk.name,
       chunkSize: chunk.size,
       chunkType: chunk.type
   });

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
           logger.debug('TRANSCRIBE_ERROR', `HTTP error! status: ${response.status}, message: ${errorText}`);
           throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
       }

       const result = await response.json();

       logger.debug('TRANSCRIBE_SUCCESS', 'Successfully transcribed chunk', {
           chunkName: chunk.name,
           transcriptionTextLength: result.text.length,
           transcriptionText: result.text
       });

       return result;

   } catch (error) {
       logger.debug('TRANSCRIBE_ERROR', error.message, {
           chunkName: chunk.name,
           chunkContentType: chunk.type
       });
       throw error;
   }
}

// Main Process
async function uploadAudio() {
   if (state.processing.isActive) return;

   const apiKey = localStorage.getItem('groqApiKey');
   const file = document.getElementById('audioFile').files[0];

   if (!apiKey || !file) {
       alert(!apiKey ? 'מפתח API חסר. נא להזין מחדש.' : 'אנא בחר קובץ להעלאה.');
       return;
   }

   state.processing.isActive = true;
   state.processing.startTime = Date.now();
   openModal('modal3');
   updateProgress(0);

   try {
       const chunks = await splitAudioFile(file);
       state.processing.totalChunks = chunks.length;
       updateProgress(10);

       for (let i = 0; i < chunks.length; i++) {
           const result = await transcribeChunk(chunks[i], apiKey);

           if (result.text) {
               state.transcription.text += result.text + ' ';
           }

           state.processing.processedChunks++;
           updateProgress(10 + ((i + 1) / chunks.length * 90));

           if (i < chunks.length - 1) {
               await new Promise(resolve => setTimeout(resolve, 500));
           }
       }

       state.transcription.text = state.transcription.text.trim();
       updateProgress(100);
       showResults();

   } catch (error) {
       logger.debug('PROCESS_ERROR', error.message);
       handleError(error);
   } finally {
       state.processing.isActive = false;
       closeModal('modal3');
   }
}

// UI Helpers
function showMessage(message, duration = 3000) {
   const messageEl = document.createElement('div');
   messageEl.className = 'status-message';
   messageEl.textContent = message;
   messageEl.style.cssText = `
       position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
       background: rgba(0,0,0,0.8); color: white; padding: 10px 20px;
       border-radius: 5px; z-index: 1000; direction: rtl;
   `;
   
   document.body.appendChild(messageEl);
   if (duration > 0) {
       setTimeout(() => messageEl.remove(), duration);
   }
}

function updateProgress(percent) {
   document.getElementById('progress').style.width = `${percent}%`;
   document.getElementById('progressText').textContent = `${Math.round(percent)}%`;
}

function showResults() {
   openModal('modal4');
   document.getElementById('textContent').textContent = state.transcription.text;
   document.getElementById('srtContent').textContent = generateSRT();
   openTab(null, 'textTab');
}

// Utility Functions
function generateSRT() {
   return state.transcription.text;
}

function handleError(error) {
   alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
}

// Modal & Tab Management
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

function openTab(evt, tabName) {
   document.querySelectorAll('.tabcontent').forEach(tab => {
       tab.style.display = 'none';
       tab.classList.remove('active');
   });
   document.querySelectorAll('.tablinks').forEach(btn => btn.classList.remove('active'));

   const selectedTab = document.getElementById(tabName);
   if (selectedTab) {
       selectedTab.style.display = 'block';
       selectedTab.classList.add('active');
   }
   if (evt?.currentTarget) {
       evt.currentTarget.classList.add('active');
       state.transcription.format = evt.currentTarget.dataset.format;
   }
}

// Restart Process
function restartProcess() {
   state.transcription.text = '';
   state.processing.isActive = false;
   state.processing.processedChunks = 0;
   state.processing.totalChunks = 0;

   updateProgress(0);
   document.getElementById('textContent').textContent = '';
   document.getElementById('srtContent').textContent = '';

   closeModal('modal3');
   closeModal('modal4');

   showMessage('התהליך אותחל בהצלחה', 3000);
}

// Download Transcription
function downloadTranscription() {
   const blob = new Blob([state.transcription.text], { type: 'text/plain;charset=utf-8' });
   const link = document.createElement('a');
   link.href = URL.createObjectURL(blob);
   link.download = `transcription_${new Date().toISOString()}.txt`;
   link.click();
}

// Save API Key
function saveApiKey() {
   const apiKey = document.getElementById('apiKeyInput').value.trim();
   if (apiKey) {
       localStorage.setItem('groqApiKey', apiKey);
       initializeUI();
   }
}
