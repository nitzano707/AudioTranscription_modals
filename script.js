// --- Constants ---
const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WAIT_TIME_BETWEEN_CHUNKS = 1000; // 1 second
const MAX_AUDIO_SECONDS_PER_HOUR = 7200; // GROQ limit

// --- Processing Statistics ---
const processingStats = {
   averageTimeByType: {
       'audio/wav': null,
       'audio/mpeg': null,
       'video/mp4': null,
       'audio/x-m4a': null
   },
   rateLimitInfo: {
       usedSeconds: 0,
       resetTime: null,
       lastCheck: null
   },
   updateAverageTime(fileType, processingTime) {
       if (!this.averageTimeByType[fileType]) {
           this.averageTimeByType[fileType] = processingTime;
       } else {
           this.averageTimeByType[fileType] = 
               (this.averageTimeByType[fileType] * 0.7 + processingTime * 0.3);
       }
       logDebug('STATS_UPDATE', `Average processing time for ${fileType}`, {
           average: this.averageTimeByType[fileType],
           lastTime: processingTime
       });
   }
};

// --- State Management ---
let state = {
   isProcessing: false,
   transcriptionText: '',
   transcriptionSRT: '',
   currentOffset: 0,
   segments: [],
   currentFormat: 'text',
   processedChunks: 0,
   totalChunks: 0,
   startTime: null
};

// --- Debug Logger ---
function logDebug(stage, message, data = null) {
   const timestamp = new Date().toISOString();
   console.log(`[${timestamp}] [${stage}] ${message}`);
   if (data) {
       console.log('Data:', data);
   }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
   initializeUI();
   setupEventListeners();
});

// --- UI Initialization and Event Handlers ---
function initializeUI() {
   const apiKey = localStorage.getItem('groqApiKey');
   document.getElementById('apiRequest').style.display = apiKey ? 'none' : 'block';
   document.getElementById('startProcessBtn').style.display = apiKey ? 'block' : 'none';
   
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

// --- File Handling ---
function handleFileSelection(event) {
   const file = event.target.files[0];
   const fileName = file ? file.name : "לא נבחר קובץ";
   document.getElementById('fileName').textContent = fileName;
   document.getElementById('uploadBtn').disabled = !file;
   
   if (file) {
       const estimatedTime = processingStats.averageTimeByType[file.type];
       logDebug('FILE_SELECTED', `File selected by user`, {
           name: fileName,
           size: file.size,
           type: file.type,
           estimatedProcessingTime: estimatedTime
       });

       // הערכת זמן עיבוד אם יש נתונים היסטוריים
       if (estimatedTime) {
           showMessage(`זמן עיבוד משוער: ${formatTime(estimatedTime)}`);
       }
   }
}

async function splitAudioFile(file) {
   logDebug('FILE_SPLIT', `Starting to process file`, {
       size: file.size,
       type: file.type
   });

   if (file.size <= MAX_CHUNK_SIZE) {
       return [file];
   }

   const chunks = Math.ceil(file.size / MAX_CHUNK_SIZE);
   const audioChunks = [];
   
   // קריאת ה-header של הקובץ המקורי
   const headerSize = getHeaderSize(file.type);
   const headerBuffer = await file.slice(0, headerSize).arrayBuffer();
   const header = new Uint8Array(headerBuffer);

   for (let i = 0; i < chunks; i++) {
       const start = i === 0 ? 0 : (i * MAX_CHUNK_SIZE);
       const end = Math.min((i + 1) * MAX_CHUNK_SIZE, file.size);
       
       let chunk;
       if (i === 0) {
           chunk = file.slice(start, end);
       } else {
           const chunkData = await file.slice(start, end).arrayBuffer();
           const combinedBuffer = new Uint8Array(header.length + chunkData.byteLength);
           combinedBuffer.set(header);
           combinedBuffer.set(new Uint8Array(chunkData), header.length);
           chunk = new Blob([combinedBuffer], { type: file.type });
       }

       const chunkFile = new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, {
           type: file.type
       });
       
       audioChunks.push(chunkFile);
       
       logDebug('CHUNK_CREATED', `Created chunk ${i + 1}/${chunks}`, {
           chunkSize: chunkFile.size,
           chunkType: chunkFile.type
       });
   }

   return audioChunks;
}

function getHeaderSize(fileType) {
   switch (fileType) {
       case 'audio/wav':
           return 44; // WAV header size
       case 'audio/mpeg':
           return 10; // MP3 header size
       case 'video/mp4':
           return 100; // MP4 header size (approximate)
       default:
           return 44;
   }
}

// --- Rate Limit Management ---
async function checkRateLimit(apiKey) {
   const now = Date.now();
   
   // אם יש מידע קודם שעדיין תקף (פחות מדקה)
   if (processingStats.rateLimitInfo.lastCheck && 
       now - processingStats.rateLimitInfo.lastCheck < 60000) {
       return processingStats.rateLimitInfo;
   }

   try {
       const response = await fetch(`${API_URL}/rate_limits`, {
           headers: { 'Authorization': `Bearer ${apiKey}` }
       });

       if (response.ok) {
           const data = await response.json();
           processingStats.rateLimitInfo = {
               usedSeconds: data.used_seconds || 0,
               remainingSeconds: MAX_AUDIO_SECONDS_PER_HOUR - (data.used_seconds || 0),
               resetTime: data.reset_time,
               lastCheck: now
           };
           
           logDebug('RATE_LIMIT', 'Updated rate limit info', processingStats.rateLimitInfo);
           return processingStats.rateLimitInfo;
       }
   } catch (error) {
       logDebug('RATE_LIMIT_ERROR', 'Failed to check rate limit', { error });
   }

   return null;
}

// --- API Communication ---
async function transcribeChunk(chunk, apiKey, chunkIndex, totalChunks) {
   const startTime = Date.now();
   
   logDebug('TRANSCRIBE_START', `Starting transcription for chunk: ${chunk.name}`, {
       chunkSize: chunk.size,
       chunkType: chunk.type,
       chunkIndex: chunkIndex,
       totalChunks: totalChunks
   });

   const formData = new FormData();
   formData.append('file', chunk);
   formData.append('model', 'whisper-large-v3-turbo');
   formData.append('response_format', 'verbose_json');
   formData.append('language', 'he');

   try {
       const response = await fetch(API_URL, {
           method: 'POST',
           headers: { 'Authorization': `Bearer ${apiKey}` },
           body: formData
       });

       if (response.status === 429) {
           // טיפול ב-Rate Limit
           const errorData = await response.json();
           const waitTimeMatch = errorData.error.message.match(/try again in (\d+)m([\d.]+)s/);
           
           if (waitTimeMatch) {
               const minutes = parseInt(waitTimeMatch[1]);
               const seconds = parseFloat(waitTimeMatch[2]);
               const waitTime = (minutes * 60 + seconds) * 1000;

               logDebug('RATE_LIMIT_WAIT', `Rate limit reached, waiting`, {
                   minutes,
                   seconds,
                   waitTime
               });

               showMessage(`הגענו למגבלת שימוש. ממתין ${minutes} דקות ו-${Math.ceil(seconds)} שניות...`);
               await new Promise(resolve => setTimeout(resolve, waitTime));
               return await transcribeChunk(chunk, apiKey, chunkIndex, totalChunks);
           }
       }

       if (!response.ok) {
           throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
       }

       const result = await response.json();
       const processingTime = Date.now() - startTime;
       
       // עדכון סטטיסטיקות
       processingStats.updateAverageTime(chunk.type, processingTime);
       
       logDebug('TRANSCRIBE_SUCCESS', `Successfully transcribed chunk`, {
           textLength: result.text?.length || 0,
           processingTime
       });

       // עדכון התקדמות
       updateProgressBasedOnTime(chunkIndex, totalChunks, processingTime);

       return result;

   } catch (error) {
       logDebug('TRANSCRIBE_ERROR', `Error during transcription`, {
           error: error.message
       });
       throw error;
   }
}

// --- Progress Management ---
function updateProgressBasedOnTime(currentChunk, totalChunks, lastChunkTime) {
   if (totalChunks === 1) {
       // קובץ קטן - התקדמות לפי אחוזים של הזמן הממוצע
       const progress = Math.min(90, (lastChunkTime / processingStats.averageTimeByType[state.currentFileType]) * 100);
       updateProgress(progress);
   } else {
       // קובץ גדול - התקדמות לפי חלקים
       const baseProgress = (currentChunk / totalChunks) * 90; // 90% maximum until completion
       updateProgress(baseProgress);
   }
}

function updateProgress(percent) {
   const progressBar = document.getElementById('progress');
   const progressText = document.getElementById('progressText');
   
   if (progressBar && progressText) {
       progressBar.style.width = `${percent}%`;
       progressText.textContent = `${Math.round(percent)}%`;
   }
}

// --- Main Processing ---
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

   // בדיקת Rate Limit לפני התחלת העיבוד
   const rateLimitInfo = await checkRateLimit(apiKey);
   if (rateLimitInfo && rateLimitInfo.remainingSeconds < 60) { // פחות מדקה נשארה
       const waitMinutes = Math.ceil((MAX_AUDIO_SECONDS_PER_HOUR - rateLimitInfo.remainingSeconds) / 60);
       alert(`נשאר מעט מדי זמן עיבוד. נא להמתין ${waitMinutes} דקות.`);
       return;
   }

   state.isProcessing = true;
   state.currentFileType = file.type;
   state.startTime = Date.now();
   
   resetState();
   openModal('modal3');
   updateProgress(0);

   try {
       const chunks = await splitAudioFile(file);
       state.totalChunks = chunks.length;
       updateProgress(10);

       let totalText = '';
       let allSegments = [];

       for (let i = 0; i < chunks.length; i++) {
           showMessage(`מתמלל חלק ${i + 1} מתוך ${chunks.length}`);
           
           const result = await transcribeChunk(chunks[i], apiKey, i, chunks.length);
           
           if (result.text) {
               totalText += result.text + ' ';
               if (result.segments) {
                   const adjustedSegments = adjustSegmentTimings(result.segments, i, chunks.length);
                   allSegments.push(...adjustedSegments);
               }
           }

           state.processedChunks++;

           if (i < chunks.length - 1) {
               await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_CHUNKS));
           }
       }

       state.transcriptionText = totalText.trim();
       state.segments = allSegments;

       const totalTime = Date.now() - state.startTime;
       logDebug('PROCESS_COMPLETE', `Transcription complete`, {
           totalTime,
           textLength: state.transcriptionText.length,
           segmentsCount: state.segments.length
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

// --- UI and Results Management ---
function showResults() {
   openModal('modal4');
   const textContent = document.getElementById('textContent');
   const srtContent = document.getElementById('srtContent');
   
   if (textContent) textContent.textContent = state.transcriptionText;
   if (srtContent) srtContent.textContent = generateSRTContent();
   
   // הצגת סטטיסטיקות עיבוד למשתמש
   const processTime = Date.now() - state.startTime;
   showMessage(`תהליך התמלול הושלם! זמן עיבוד: ${formatTime(processTime)}`, 5000);
   
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

function showMessage(message, duration = 3000) {
   const existingMsg = document.getElementById('statusMessage');
   if (existingMsg) {
       document.body.removeChild(existingMsg);
   }

   const messageElement = document.createElement('div');
   messageElement.id = 'statusMessage';
   messageElement.textContent = message;
   messageElement.style.position = 'fixed';
   messageElement.style.top = '20px';
   messageElement.style.left = '50%';
   messageElement.style.transform = 'translateX(-50%)';
   messageElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
   messageElement.style.color = 'white';
   messageElement.style.padding = '10px 20px';
   messageElement.style.borderRadius = '5px';
   messageElement.style.zIndex = '1000';
   messageElement.style.direction = 'rtl';
   
   document.body.appendChild(messageElement);
   if (duration > 0) {
       setTimeout(() => {
           if (messageElement.parentNode) {
               document.body.removeChild(messageElement);
           }
       }, duration);
   }
   return messageElement;
}

// --- Utility Functions ---
function formatTime(ms) {
   const minutes = Math.floor(ms / 60000);
   const seconds = ((ms % 60000) / 1000).toFixed(1);
   return `${minutes}:${seconds.padStart(4, '0')}`;
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

function adjustSegmentTimings(segments, chunkIndex, totalChunks) {
   const chunkDuration = 30;
   const timeOffset = chunkIndex * chunkDuration;
   
   return segments.map(segment => ({
       ...segment,
       start: segment.start + timeOffset,
       end: segment.end + timeOffset
   }));
}

function handleError(error) {
   logDebug('ERROR_HANDLER', `Processing error`, { error: error.message });

   if (error.message.includes('401')) {
       alert('שגיאה במפתח API. נא להזין מפתח חדש.');
       localStorage.removeItem('groqApiKey');
       location.reload();
   } else {
       alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
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

function resetState() {
   state = {
       ...state,
       transcriptionText: '',
       transcriptionSRT: '',
       currentOffset: 0,
       segments: [],
       processedChunks: 0,
       totalChunks: 0
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

// --- Modal and Tab Management ---
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
