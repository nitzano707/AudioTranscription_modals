// Constants
const MAX_CHUNK_SIZE = 13 * 1024 * 1024;  // 3MB
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const RATE_LIMIT_PER_HOUR = 7200; // seconds
const MINIMUM_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB - for merging small chunks
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
       averageTimeByType: {},
       processedChunks: 0,
       totalChunks: 0
   },
   transcription: {
       text: '',
       segments: [],
       format: 'text'
   },
   rateLimit: {
       usedSeconds: 0,
       lastCheck: null,
       resetTime: null
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

    // Event listeners for tab links
    document.querySelectorAll('.tablinks').forEach(tab => {
        tab.addEventListener('click', (e) => openTab(e, e.currentTarget.dataset.format));
    });

    const restartBtn = document.querySelector('#modal4 button[onclick="restartProcess()"]');
    const downloadBtn = document.querySelector('#modal4 button[onclick="downloadTranscription()"]');

    if (restartBtn) {
        restartBtn.addEventListener('click', restartProcess);
    } else {
        logger.debug('ERROR', 'restartBtn element not found in the DOM.');
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadTranscription);
    } else {
        logger.debug('ERROR', 'downloadBtn element not found in the DOM.');
    }
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

   const avgTime = state.processing.averageTimeByType[file.type];
   logger.debug('FILE_SELECTED', `Selected file: ${fileName}`, {
       size: file.size,
       type: file.type,
       estimatedTime: avgTime
   });
   
   if (avgTime) {
       showMessage(`זמן עיבוד משוער: ${formatTime(avgTime)}`);
   }
}

// Audio Processing
async function splitAudioFile(file) {
   const chunkSize = MAX_CHUNK_SIZE;
   const chunks = Math.ceil(file.size / chunkSize);
   const audioChunks = [];

   for (let i = 0; i < chunks; i++) {
       const start = i * chunkSize;
       const end = Math.min((i + 1) * chunkSize, file.size);

       let chunk = file.slice(start, end);

       // Merge small chunks to avoid issues with small files
       if (chunk.size < MINIMUM_CHUNK_SIZE && i > 0) {
           // Merge with the previous chunk
           const previousChunk = audioChunks.pop();
           const combinedBuffer = await new Blob([previousChunk, chunk]).arrayBuffer();
           chunk = new Blob([combinedBuffer], { type: file.type });
       }

       const chunkFile = new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, {
           type: file.type
       });

       audioChunks.push(chunkFile);

       // Log the creation of each chunk
       logger.debug('CHUNK_CREATED', `Created chunk ${i + 1}/${chunks}`, {
           chunkSize: chunkFile.size,
           chunkType: chunkFile.type,
           chunkName: chunkFile.name,
           headerBytes: await getChunkHeader(chunkFile)
       });
   }

   logger.debug('SPLIT_AUDIO_COMPLETE', `Completed splitting audio file into ${audioChunks.length} chunks`, {
       totalChunks: audioChunks.length,
       chunkDetails: audioChunks.map((chunk, index) => ({
           chunkIndex: index + 1,
           chunkSize: chunk.size,
           chunkType: chunk.type
       }))
   });

   return audioChunks;
}

// Function to get header bytes of a chunk
async function getChunkHeader(chunk) {
   try {
       const headerSize = FILE_TYPES[chunk.type]?.headerSize || 0;
       if (headerSize === 0) return 'N/A';
       const headerBuffer = await chunk.slice(0, headerSize).arrayBuffer();
       return Array.from(new Uint8Array(headerBuffer))
           .map(byte => byte.toString(16).padStart(2, '0'))
           .join(' ');
   } catch (error) {
       logger.debug('HEADER_ERROR', `Error reading header for chunk: ${chunk.name}`, { error: error.message });
       return 'Error reading header';
   }
}

// API Communication
async function transcribeChunk(chunk, apiKey) {
   const startTime = Date.now();
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
           logger.debug('TRANSCRIBE_ERROR', `HTTP error! status: ${response.status}, message: ${errorText}`, {
               chunkName: chunk.name,
               responseStatus: response.status,
               responseHeaders: [...response.headers]
           });
           throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
       }

       const result = await response.json();
       const processTime = Date.now() - startTime;

       // Update processing statistics
       state.processing.averageTimeByType[chunk.type] = 
           (state.processing.averageTimeByType[chunk.type] || processTime) * 0.7 + processTime * 0.3;

       logger.debug('TRANSCRIBE_SUCCESS', 'Successfully transcribed chunk', {
           chunkName: chunk.name,
           responseTime: processTime,
           transcriptionTextLength: result.text.length,
           transcriptionText: result.text
       });

       // Append the transcribed text to the global transcription state
       state.transcription.text += result.text + ' ';
       state.transcription.segments.push(...result.segments);

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
           showMessage(`מתמלל חלק ${i + 1} מתוך ${chunks.length}`);
           await transcribeChunk(chunks[i], apiKey);

           state.processing.processedChunks++;
           updateProgress(10 + ((i + 1) / chunks.length * 90));

           if (i < chunks.length - 1) {
               await new Promise(resolve => setTimeout(resolve, 500));
           }
       }

       state.transcription.text = state.transcription.text.trim();
       
       // Log the complete transcription text
       logger.debug('COMPLETE_TRANSCRIPTION', 'Completed transcription for all chunks', {
           completeTranscription: state.transcription.text
       });

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
   return messageEl;
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
function adjustSegments(segments, chunkIndex, totalChunks) {
   const timeOffset = chunkIndex * 30;
   return segments.map(seg => ({
       ...seg,
       start: seg.start + timeOffset,
       end: seg.end + timeOffset
   }));
}

function generateSRT() {
   if (!state.transcription.segments.length) return state.transcription.text;
   
   return state.transcription.segments
       .map((seg, i) => `${i + 1}\n${formatTime(seg.start)} --> ${formatTime(seg.end)}\n${seg.text}\n`)
       .join('\n');
}

function formatTime(seconds) {
   if (typeof seconds !== 'number') return '00:00:00,000';
   const date = new Date(seconds * 1000);
   return [
       date.getUTCHours().toString().padStart(2, '0'),
       date.getUTCMinutes().toString().padStart(2, '0'),
       date.getUTCSeconds().toString().padStart(2, '0')
   ].join(':') + ',' + date.getUTCMilliseconds().toString().padStart(3, '0');
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
   // Reset application state
   state.transcription.text = '';
   state.transcription.segments = [];
   state.processing.isActive = false;
   state.processing.processedChunks = 0;
   state.processing.totalChunks = 0;
   
   // Update UI progress
   updateProgress(0);
   
   // Clear displayed transcription text
   document.getElementById('textContent').textContent = '';
   document.getElementById('srtContent').textContent = '';

   // Close all open modals
   closeModal('modal3'); // Transcription progress modal
   closeModal('modal4'); // Results display modal

   // Show reset message to user
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
