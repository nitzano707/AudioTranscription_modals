// משתנים גלובליים
const MAX_SEGMENT_SIZE_MB = 24; // גודל מקטע מקסימלי ב-MB

// משתנים לאחסון התמלול בפורמטים שונים
let estimatedTime = 0;
let transcriptionDataText = '';
let transcriptionDataSRT = '';
let audioFileName = ''; // הוספת המשתנה החסר
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית

// המשתנה global שנצבר עם הזמן המצטבר הכולל בכל מקטע
let totalElapsedTime = 0;

let firstChunkDuration = 0;

let apiKey = localStorage.getItem('groqApiKey');

document.addEventListener('DOMContentLoaded', () => {
    apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
        document.getElementById('apiKeyInput').focus(); // הוספת הפוקוס כאן 
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
       
    }
    document.getElementById('textTab').style.display = 'block';
    document.querySelector("button[onclick*='textTab']").classList.add('active');
    displayTranscription('text');
});


function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput').value;
    if (apiKeyInput) {
        localStorage.setItem('groqApiKey', apiKeyInput);
        apiKey = apiKeyInput; // עדכון משתנה גלובלי
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}


function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    if (this.files[0]) {
        audioFileName = this.files[0].name;
        document.getElementById('fileName').textContent = fileName;
        document.getElementById('uploadBtn').disabled = false;
        // תוספת שלי:
        document.getElementById('uploadBtn').classList.add('start-over');
    } else {
        document.getElementById('fileName').textContent = "לא נבחר קובץ";
        document.getElementById('uploadBtn').disabled = true;
        // תוספת שלי:
        document.getElementById('uploadBtn').classList.remove('start-over');
    }
});

async function uploadAudio() {
   const audioFile = document.getElementById('audioFile').files[0];
   
   if (!audioFile) {
       alert('אנא בחר קובץ להעלאה.');
       return;
   }

   // בדיקת סוג וגודל הקובץ
   const fileType = audioFile.type.toLowerCase();
   const fileExtension = audioFile.name.split('.').pop().toLowerCase();
   const isM4A = fileType.includes('m4a') || fileExtension === 'm4a';
   const sizeInMB = audioFile.size / (1024 * 1024);

   // בדיקת הגבלת גודל רק עבור קבצי M4A
   if (isM4A && sizeInMB > MAX_SEGMENT_SIZE_MB) {
       alert(`קבצי M4A חייבים להיות קטנים מ-${MAX_SEGMENT_SIZE_MB}MB. אנא העלה קובץ קטן יותר או השתמש בפורמט MP3/WAV.`);
       document.getElementById('audioFile').value = ""; 
       document.getElementById('fileName').textContent = "לא נבחר קובץ";
       document.getElementById('uploadBtn').disabled = true;
       return;
   }

   // בדיקת סוג הקובץ
   if (!fileType.includes('mp3') && 
       !fileType.includes('wav') && 
       !fileType.includes('m4a') && 
       !fileExtension === 'mp3' && 
       !fileExtension === 'wav' && 
       !fileExtension === 'm4a') {
       alert('פורמט קובץ לא נתמך. אנא השתמש בקובץ בפורמט MP3, WAV, או M4A.');
       return;
   }

   calculateEstimatedTime();
   
   if (!apiKey) {
       alert('מפתח API חסר. נא להזין מחדש.');
       return;
   }

   openModal('modal3');
   const modal = document.getElementById('modal3');
   if (modal) {
       const modalBody = modal.querySelector('.modal-body p');
       if (modalBody) {
           modalBody.innerHTML = `ברגעים אלה הקובץ <strong>${audioFileName}</strong> עולה ועובר תהליך עיבוד. בסיום התהליך יוצג התמלול`;
       }
   } else {
       console.warn("Modal or modal header not found.");
   }

   // חישוב הערכת זמן מבוסס על גודל הקובץ וסוגו
   let estimatedDurationInMinutes;
   if (fileType.includes('mp3') || fileExtension === 'mp3') {
       estimatedDurationInMinutes = (sizeInMB / 0.96); // הערכה עבור MP3 בקצב של 128 קילובייט לשנייה
   } else if (fileType.includes('wav') || fileExtension === 'wav') {
       estimatedDurationInMinutes = (sizeInMB / 10); // הערכה גסה עבור WAV (לא דחוס)
   } else if (isM4A) {
       estimatedDurationInMinutes = (sizeInMB / 0.75); // הערכה עבור M4A
   }

   // הודעת אזהרה אם סך הדקות מוערך כגדול מ-120 דקות
   if (estimatedDurationInMinutes > 120) {
       alert(`משך הקובץ מוערך כ-${Math.round(estimatedDurationInMinutes)} דקות, ייתכן שהוא יחרוג ממכסת התמלול של 120 דקות לשעה. אנא היוועץ אם להמשיך.`);
   }

   const maxChunkSizeBytes = MAX_SEGMENT_SIZE_MB * 1024 * 1024;
   let transcriptionData = [];
   let totalTimeElapsed = 0;

   try {
       console.log("Starting to split the audio file into chunks...");
       const chunks = await splitAudioToChunksBySize(audioFile, maxChunkSizeBytes);
       const totalChunks = chunks.length;
       console.log(`Total chunks created: ${totalChunks}`);

       for (let i = 0; i < totalChunks; i++) {
           const chunkFile = new File([chunks[i]], `chunk_${i + 1}.${audioFile.name.split('.').pop()}`, { type: audioFile.type });
           if (i === 0) {
               document.getElementById('progress').style.width = '0%';
               document.getElementById('progressText').textContent = '0%';
           }
           updateProgressBarSmoothly(i + 1, totalChunks, estimatedTime);

           await processAudioChunk(chunkFile, transcriptionData, i + 1, totalChunks, totalTimeElapsed);
           if (chunks[i].duration) {
               totalTimeElapsed += chunks[i].duration;
           }

           await new Promise(resolve => setTimeout(resolve, 500));
       }

       saveTranscriptions(transcriptionData, audioFile.name);
       displayTranscription('text');
       closeModal('modal3');
       openModal('modal4');
       const modal4 = document.getElementById('modal4');
       if (modal4) {
           const modalBody = modal4.querySelector('.modal-body p');
           if (modalBody) {
               modalBody.innerHTML = `תמלול הקובץ <strong>${audioFileName}</strong> הושלם`;
           }
       }
   } catch (error) {
       console.error('Error during audio processing:', error);
       closeModal('modal3');
       alert('שגיאה במהלך התמלול. נא לנסות שוב.');
   }
}

function copyTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להעתקה. נא לבחור פורמט מתמלול.');
        return;
    }
    const format = activeTab.getAttribute('data-format');
    let textToCopy;

    if (format === "text") {
        if (!transcriptionDataText) {
            alert('אין תמלול להעתקה.');
            return;
        }
        textToCopy = transcriptionDataText;
    } else if (format === "srt") {
        if (!transcriptionDataSRT) {
            alert('אין תמלול להעתקה.');
            return;
        }
        textToCopy = transcriptionDataSRT;
    }

    // העתקת התמלול ללוח
    navigator.clipboard.writeText(textToCopy).then(() => {
        // הצגת הודעת פופ-אפ לאחר העתקה מוצלחת
        const copyMessage = document.getElementById('copyMessage');
        if (copyMessage) {
            copyMessage.style.display = 'block';
            setTimeout(() => {
                copyMessage.style.display = 'none';
            }, 2000); // ההודעה תוצג למשך 2 שניות
        } else {
            console.warn("copyMessage element not found in the DOM.");
        }
    }).catch((error) => {
        console.error('Failed to copy text:', error);
        alert('שגיאה בהעתקת הטקסט. נא לנסות שוב.');
    });
}



function resetProcess() {
    // איפוס כל המשתנים הגלובליים
    estimatedTime = 0;
    audioFileName = '';
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    totalElapsedTime = 0;
    firstChunkDuration = 0;

    // איפוס הממשק וחזרה למסך הראשי
    closeModal('modal1');
    closeModal('modal3');
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('startProcessBtn').style.display = 'block';
}




async function splitAudioToChunksBySize(file, maxChunkSizeBytes) {
    // אם הקובץ קטן מהמגבלה, אין צורך לפצל
    if (file.size <= maxChunkSizeBytes) {
        return [file];
    }

    // בדיקה גמישה לסוג הקובץ עם שימוש ב-file.type ובשם הקובץ
    const fileType = file.type || '';
    const fileName = file.name || '';

    // בדיקות לפי סוג הקובץ
    if (fileType.includes('wav') || fileName.endsWith('.wav')) {
        console.log("Detected WAV file");
        return splitWavFile(file, maxChunkSizeBytes);
    } else if (fileType.includes('mp3') || fileName.endsWith('.mp3')) {
        console.log("Detected MP3 file");
        return await splitMp3File(file, maxChunkSizeBytes);
    } else {
        throw new Error('פורמט קובץ לא נתמך לפיצול. אנא השתמש בקובץ בפורמט MP3 או WAV.');
    }
}




async function splitWavFile(file, maxChunkSizeBytes) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalSizeBytes = file.size;
    const numberOfChunks = Math.ceil(totalSizeBytes / maxChunkSizeBytes);
    const chunkDuration = audioBuffer.duration / numberOfChunks;
    let currentTime = 0;
    const chunks = [];

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
        if (blob.size > maxChunkSizeBytes) {
            console.warn('Chunk exceeded max size, splitting further');
            // הוספת 5 שניות לסרגל ההתקדמות כאשר מתבצע פיצול נוסף
            estimatedTime += 5;
            const subChunks = await splitWavFile(blob, maxChunkSizeBytes);
            chunks.push(...subChunks);
        } else {
            chunks.push(blob);
        }
        currentTime = end;
    }

    return chunks;
}



async function splitMp3File(file, maxChunkSizeBytes) {
    const chunks = [];
    const totalChunks = Math.ceil(file.size / maxChunkSizeBytes);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * maxChunkSizeBytes;
        const end = Math.min((i + 1) * maxChunkSizeBytes, file.size);
        const chunk = file.slice(start, end);
        if (chunk.size > maxChunkSizeBytes) {
            console.warn('MP3 chunk exceeded max size, splitting further');
            const subChunks = await splitMp3File(chunk, maxChunkSizeBytes);
            chunks.push(...subChunks);
        } else {
            chunks.push(chunk);
        }
    }

    return chunks;
}
    

function bufferToWaveBlob(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

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
    setUint32(16);         // PCM format
    setUint16(1);          // format (PCM)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4);

    for (let i = 0; i < abuffer.numberOfChannels; i++) {
        channels.push(abuffer.getChannelData(i));
    }

    while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
            const sample = Math.max(-1, Math.min(1, channels[i][offset]));
            view.setInt16(pos, sample < 0 ? sample * 32768 : sample * 32767, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([buffer], { type: "audio/wav" });
}

async function processAudioChunk(chunk, transcriptionData, currentChunk, totalChunks) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json'); 
    formData.append('language', defaultLanguage);

    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין שוב.');
        location.reload();
        return;
    }

    try {
        console.log(`Sending chunk ${currentChunk} of ${totalChunks} to the API...`);
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`Received response for chunk ${currentChunk}:`, data);

            if (data.segments) {
                data.segments.forEach((segment) => {
                    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
                        const startTime = formatTimestamp(segment.start + totalElapsedTime);
                        const endTime = formatTimestamp(segment.end + totalElapsedTime);
                        const text = segment.text.trim();

                        transcriptionData.push({
                            text: text,
                            timestamp: `${startTime} --> ${endTime}`
                        });
                    } else {
                        console.warn(`Invalid timestamp for segment:`, segment);
                    }
                });

                // עדכון totalElapsedTime לפי זמן הסיום של המקטע האחרון
                const lastSegment = data.segments[data.segments.length - 1];
                if (lastSegment && typeof lastSegment.end === 'number') {
                    totalElapsedTime += lastSegment.end;
                }
            } else {
                console.warn(`Missing segments in response for chunk ${currentChunk}`);
            }
        } else {
            if (response.status === 401) {
                alert('שגיאה במפתח API. נא להזין מפתח חדש.');
                localStorage.removeItem('groqApiKey');
                location.reload();
                return;
            }
            const errorText = await response.text();
            console.error(`Error for chunk ${currentChunk}:`, errorText);
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error && errorData.error.code === 'rate_limit_exceeded') {
                    let waitTime = errorData.error.message.match(/try again in ([\d\w\.]+)/)[1];
                    waitTime = waitTime
                        .replace('s', ' שניות')
                        .replace('m', ' דקות')
                        .replace('h', ' שעות')
                        .replace('d', ' ימים');

                    alert(`מכסת התמלולים שלך לשעה הסתיימה. נא להמתין ${waitTime} ולהתחיל מחדש את התהליך.`);
                    resetProcess();
                    return;
                }
            } catch (parseError) {
                console.warn('Failed to parse error response:', parseError);
            }
        }
    } catch (error) {
        console.error('Network error:', error);
    }
}







function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) {
        console.error('Invalid seconds value for timestamp:', seconds);
        return '00:00:00,000';
    }
    const date = new Date(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `${hours}:${minutes}:${secs},${millis}`;
}


function saveTranscriptions(data, audioFileName) {
    // const title = `תמלול קובץ אודיו: ${audioFileName}\n\n`; // כותרת עם שם הקובץ
    const title = `תמלול קובץ אודיו: ${audioFileName}  :בוצע באמצעות https://tamleli.netlify.app\n\n`; // כותרת עם שם הקובץ

    // הוספת הכותרת לפני כל תמלול
    transcriptionDataText = title + data.map(d => cleanText(d.text)).join(" ").trim();
    transcriptionDataSRT = title + data.map((d, index) => {
        return `${index + 1}\n${d.timestamp}\n${cleanText(d.text)}\n`;
    }).join("\n\n");
}



function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function displayTranscription(format) {
    let transcriptionResult;
    if (format === "text") {
        transcriptionResult = document.getElementById('textContent');
    } else if (format === "srt") {
        transcriptionResult = document.getElementById('srtContent');
    }

    if (!transcriptionResult) return;

    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    transcriptionResult.textContent = (format === "text") ? transcriptionDataText : transcriptionDataSRT;
    transcriptionResult.parentElement.style.display = "block";
}

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

// פונקציה לבחירת כרטיסיה לתצוגת התמלול (טקסט או SRT)
function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    const tablinks = document.getElementsByClassName("tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";

    // עדכון התמלול בהתאם לכרטיסיה שנבחרה
    const format = evt.currentTarget.getAttribute('data-format');
    displayTranscription(format);
}

// פונקציה להורדת תמלול
function downloadTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט מתמלול.');
        return;
    }
    const format = activeTab.getAttribute('data-format');
    let blob, fileName;

    // קיצור שם קובץ האודיו ל-15 תווים לכל היותר, כדי לא ליצור שם ארוך מדי
    const shortAudioFileName = audioFileName.length > 15 ? audioFileName.substring(0, 15) + "..." : audioFileName;

    if (format === "text") {
        if (!transcriptionDataText) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataText], { type: 'text/plain' });
        fileName = `transcription_${shortAudioFileName}.txt`;
    } else if (format === "srt") {
        if (!transcriptionDataSRT) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataSRT], { type: 'text/plain' });
        fileName = `transcription_${shortAudioFileName}.srt`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


    

// פונקציה לחישוב זמן משוער לפי סוג וגודל הקובץ
function calculateEstimatedTime() {
    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) return;
    const sizeMB = audioFile.size / (1024 * 1024);
    if (audioFile.type.includes('mp3')) {
        estimatedTime = sizeMB * 1; // MP3: 1 שנייה לכל מגה בייט
    } else if (audioFile.type.includes('wav')) {
        estimatedTime = sizeMB * 0.4; // WAV: 0.4 שניות לכל מגה בייט
    } else {
        estimatedTime = sizeMB * 1.5; // ברירת מחדל
    }
}

// פונקציה לעדכון חלק של סרגל ההתקדמות
function updateProgressBarSmoothly(currentChunk, totalChunks, estimatedTime) {
    const progressElement = document.getElementById('progress');
    const progressTextElement = document.getElementById('progressText');
    const interval = estimatedTime / totalChunks * 1000;
    let startProgress = ((currentChunk - 1) / totalChunks) * 100;
    let endProgress = (currentChunk / totalChunks) * 100;
    let currentProgress = startProgress;

    const smoothProgress = setInterval(() => {
        currentProgress += 1;
        if (currentProgress >= endProgress) {
            currentProgress = endProgress;
            clearInterval(smoothProgress);
        }
        progressElement.style.width = `${currentProgress}%`;
        progressTextElement.textContent = `${Math.round(currentProgress)}%`;
    }, interval / (endProgress - startProgress));
}


function showSpeakerSegmentationModal() {
    openModal('speakerSegmentationModal');
}

// 1. הפונקציה הראשית לחלוקה לדוברים
async function startSpeakerSegmentation() {
    console.log("Starting speaker segmentation process...");
    
    let intervieweeName = document.getElementById('intervieweeNameInput').value.trim();
    if (!intervieweeName) {
        intervieweeName = "מרואיין";
    }
    console.log("Interviewee name:", intervieweeName);

    const transcriptionText = transcriptionDataText;
    console.log("Original text length:", transcriptionText.length);
    console.log("First 100 chars of text:", transcriptionText.substring(0, 100));

    if (!transcriptionText) {
        console.error("No transcription text found!");
        alert("לא נמצא טקסט לעיבוד. נא לוודא שיש תמלול.");
        return;
    }

    document.getElementById("segmentationResult").textContent = "מתחיל בעיבוד התמלול...\n\n";

    try {
        const result = await processTranscriptionWithContext(transcriptionText, intervieweeName);
        console.log("Processing completed successfully");
        document.getElementById("segmentationResult").textContent = result + "\n\n---\nסוף תמלול";
        
        document.getElementById("copyButton").style.display = "block";
        document.getElementById("downloadButton").style.display = "block";
    } catch (error) {
        console.error("Error in speaker segmentation:", error);
        document.getElementById("segmentationResult").textContent = "אירעה שגיאה בעיבוד התמלול. נא לנסות שוב.";
    }
}

// 2. פונקציה לעיבוד עם הקשר
async function processTranscriptionWithContext(transcriptionText, intervieweeName) {
    console.log("Starting processTranscriptionWithContext");
    const segments = createOverlappingSegments(transcriptionText);
    console.log(`Created ${segments.length} segments`);
    console.log("First segment:", segments[0]);

    let fullResult = '';
    let previousContext = '';
    
    for (let i = 0; i < segments.length; i++) {
        console.log(`Processing segment ${i + 1} of ${segments.length}`);
        const segment = segments[i];
        
        const promptWithContext = createPromptWithContext(segment.text, previousContext, intervieweeName);
        console.log(`Created prompt for segment ${i + 1}. Prompt length:`, promptWithContext.length);
        
        try {
            console.log(`Sending segment ${i + 1} to API...`);
            const result = await getSegmentedText(segment.text, promptWithContext);
            console.log(`Received result for segment ${i + 1}. Result length:`, result.length);
            
            previousContext = segment.text.slice(-200);
            const processedResult = removeOverlap(result, fullResult);
            console.log(`Processed result length after overlap removal:`, processedResult.length);
            
            fullResult += processedResult;
            updateProgressDisplay(i + 1, segments.length);
            
        } catch (error) {
            console.error(`Error processing segment ${i + 1}:`, error);
            throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log("Processing completed. Final result length:", fullResult.length);
    return fullResult.trim();
}

// 3. פונקציה ליצירת פרומפט עם הקשר
function createPromptWithContext(segmentText, previousContext, intervieweeName) {
    console.log("Creating prompt with context. Interview name:", intervieweeName);
    const prompt = `אתה מומחה לעיבוד טקסט ותמלולים. עליך לעבד את קטע התמלול הבא ולבצע בו שתי פעולות עיקריות:

1. חלוקה מדויקת לדוברים: 
- סמן כל קטע טקסט עם הדובר המתאים: "מראיין:" או "${intervieweeName}:"
- קריטריונים לזיהוי:
  * דברי המראיין: שאלות ישירות, הנחיות שיחה, בקשות להרחבה
  * דברי ${intervieweeName}: תשובות מפורטות, שיתוף חוויות אישיות, הסברים מקצועיים

2. תיקונים פונטיים ולשוניים:
- זהה מילים ששובשו בתמלול והצג תיקון בסוגריים מרובעים
- שמור על התיקונים המקוריים מהקטע הקודם
- דוגמאות לתיקונים:
  * שיבושי הגייה: "להתקשור" → "להתקשור [להתקשר]"
  * צירופי מילים: "בבית הספר יסודי" → "בבית הספר יסודי [בבית הספר היסודי]"
  * שמות מוסדות: "במכלה למנהל" → "במכלה [במכללה] למנהל"

הקשר קודם:
${previousContext ? `הקטע הקודם הסתיים ב: "${previousContext}"` : 'זהו תחילת התמלול'}

הנחיות חשובות:
1. העתק את כל הטקסט המקורי - אל תשמיט שום חלק
2. שמור על כל סימני הפיסוק והרווחים המקוריים
3. הצג תמיד את המילה המקורית ואחריה את התיקון בסוגריים
4. הקפד על המשך רצף הגיוני של השיחה

טקסט לעיבוד:
${segmentText}`;

    console.log("Prompt created. Length:", prompt.length);
    return prompt;
}

// 4. פונקציה ליצירת קטעים עם חפיפה
function createOverlappingSegments(text, maxChars = 500, overlap = 100) {
    console.log("Starting text segmentation. Text length:", text.length);
    
    if (!text || text.length === 0) {
        console.error("Empty text received");
        return [];
    }

    const segments = [];
    let currentPosition = 0;

    while (currentPosition < text.length) {
        // קביעת נקודת הסיום הפוטנציאלית
        let endPosition = Math.min(currentPosition + maxChars, text.length);
        
        // אם זה לא הסגמנט האחרון, חפש נקודת סיום טבעית
        if (endPosition < text.length) {
            let naturalBreak = findLastSentenceEnd(text.substring(currentPosition, endPosition + 100));
            if (naturalBreak > 0) {
                endPosition = currentPosition + naturalBreak;
            }
        }

        // הוספת הסגמנט
        const segment = {
            text: text.substring(currentPosition, endPosition),
            startIndex: currentPosition,
            endIndex: endPosition
        };
        
        segments.push(segment);
        console.log(`Created segment ${segments.length}:`, {
            length: segment.text.length,
            start: currentPosition,
            end: endPosition,
            preview: segment.text.substring(0, 50) + '...'
        });

        // התקדמות לנקודה הבאה
        if (endPosition >= text.length) {
            break;
        }
        currentPosition = Math.max(currentPosition + 1, endPosition - overlap);
    }

    console.log(`Created ${segments.length} segments in total`);
    return segments;
}


// פונקציה חדשה למציאת סוף משפט אחרון
function findLastSentenceEnd(text) {
    const sentenceEndings = ['. ', '? ', '! ', '.\n', '?\n', '!\n', '. ', '? ', '! '];
    let lastFound = -1;

    for (const ending of sentenceEndings) {
        const lastIndex = text.lastIndexOf(ending);
        if (lastIndex > lastFound) {
            lastFound = lastIndex + ending.length;
        }
    }

    return lastFound > 0 ? lastFound : text.length;
}

// 5. פונקציה למציאת נקודת חיתוך טבעית
function findNaturalBreak(text, around) {
    const sentenceEndings = ['. ', '? ', '! ', '.\n', '?\n', '!\n'];
    let bestBreak = around;
    let minDistance = Infinity;
    
    // מגבלת החיפוש ל-100 תווים לפני ואחרי
    const searchStart = Math.max(0, around - 100);
    const searchEnd = Math.min(text.length, around + 100);
    
    for (let i = searchStart; i < searchEnd; i++) {
        for (const ending of sentenceEndings) {
            if (text.slice(i, i + ending.length) === ending) {
                const distance = Math.abs(i - around);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestBreak = i + ending.length;
                }
            }
        }
    }
    
    // אם לא נמצאה נקודת חיתוך טבעית, נחזיר את הנקודה המקורית
    if (bestBreak === around && around < text.length) {
        console.warn("No natural break found, using original position:", around);
        return around;
    }
    
    return bestBreak;
}

// 6. פונקציה להסרת חפיפה
function removeOverlap(newText, previousText, minOverlap = 20) {
    console.log("Removing overlap. New text length:", newText.length, 
                "Previous text length:", previousText?.length || 0);
    
    if (!previousText) return newText;
    
    let maxOverlap = 0;
    let overlapLength = Math.min(previousText.length, newText.length, 200);
    
    for (let i = minOverlap; i <= overlapLength; i++) {
        if (previousText.slice(-i) === newText.slice(0, i)) {
            maxOverlap = i;
        }
    }
    
    console.log("Found overlap length:", maxOverlap);
    return newText.slice(maxOverlap);
}

// 7. פונקציה לעדכון תצוגת ההתקדמות
function updateProgressDisplay(current, total) {
    const percentage = Math.round((current / total) * 100);
    const progressText = `\nמעבד קטע ${current} מתוך ${total} (${percentage}%)...`;
    const currentText = document.getElementById("segmentationResult").textContent;
    
    // מחיקת שורת ההתקדמות הקודמת אם קיימת
    const lastProgressIndex = currentText.lastIndexOf('\nמעבד קטע');
    const newText = lastProgressIndex >= 0 
        ? currentText.substring(0, lastProgressIndex) + progressText
        : currentText + progressText;
        
    document.getElementById("segmentationResult").textContent = newText;
}

// 8. פונקציית הקריאה ל-API
async function getSegmentedText(text, prompt) {
    console.log("Starting API request with text length:", text.length);

    let success = false;
    const maxRetries = 5;
    let retries = 0;

    while (!success && retries < maxRetries) {
        if (!apiKey) {
            console.error("API Key missing");
            throw new Error("API Key not found in local storage.");
        }

        try {
            console.log(`Attempt ${retries + 1} of ${maxRetries}`);
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "llama3-70b-8192",
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: text }
                    ],
                    max_tokens: 1024
                })
            });

            console.log("API response status:", response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log("API response received successfully");
                success = true;
                let segmentedText = result.choices[0].message.content;
                segmentedText = segmentedText.replace(/(מראיין:|מרואיין:)/g, "\n$1");
                return segmentedText;
            } else {
                const errorText = await response.text();
                console.error("API error response:", errorText);
                const errorData = JSON.parse(errorText);

                if (errorData.error && errorData.error.code === "rate_limit_exceeded") {
                    const waitTime = extractWaitTime(errorText);
                    if (waitTime) {
                        console.log(`Rate limit exceeded. Waiting ${waitTime} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    } else {
                        retries++;
                    }
                } else {
                    throw new Error(`API request error: ${errorText}`);
                }
            }
        } catch (error) {
            console.error("API request failed:", error);
            retries++;
        }
    }

    throw new Error("Failed to get segmented text after multiple retries");
}


// פונקציה שמחלצת את זמן ההמתנה מתוך הודעת השגיאה
function extractWaitTime(errorText) {
    const match = errorText.match(/try again in ([\d.]+)s/);
    return match ? parseFloat(match[1]) : null;
}

function splitTextIntoSegments(text, maxChars = 500, maxSentences = 5) {
    const segments = [];
    let currentSegment = "";
    let sentenceCount = 0;

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    for (let sentence of sentences) {
        if ((currentSegment.length + sentence.length > maxChars) || sentenceCount >= maxSentences) {
            segments.push(currentSegment.trim());
            currentSegment = "";
            sentenceCount = 0;
        }

        currentSegment += sentence + " ";
        sentenceCount++;
    }

    if (currentSegment.trim()) {
        segments.push(currentSegment.trim());
    }

    return segments;
}





function splitTextIntoSegments(text, maxChars = 500, maxSentences = 5) {
    const segments = [];
    let currentSegment = "";
    let sentenceCount = 0;

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    for (let sentence of sentences) {
        if ((currentSegment.length + sentence.length > maxChars) || sentenceCount >= maxSentences) {
            segments.push(currentSegment.trim());
            currentSegment = "";
            sentenceCount = 0;
        }

        currentSegment += sentence + " ";
        sentenceCount++;
    }

    if (currentSegment.trim()) {
        segments.push(currentSegment.trim());
    }

    return segments;
}


function copySegmentationResult() {
    const segmentationResult = document.getElementById('segmentationResult').textContent;
    if (segmentationResult) {
        navigator.clipboard.writeText(segmentationResult).then(() => {
            alert('תמלול הועתק בהצלחה!');
        }).catch((error) => {
            console.error('שגיאה בהעתקת הטקסט:', error);
        });
    }
}

function downloadSegmentationResult() {
    const segmentationResult = document.getElementById('segmentationResult').textContent;
    if (segmentationResult) {
        const blob = new Blob([segmentationResult], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'segmentation_result.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}



// פונקציה לאיפוס תהליך ההעלאה והתמלול
function restartProcess() {
    // איפוס כל המשתנים הגלובליים
    estimatedTime = 0;
    audioFileName = '';
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    speakerSegmentationData = ''; // איפוס חלוקה לדוברים
    totalElapsedTime = 0;
    firstChunkDuration = 0;

    // איפוס הממשק וחזרה למסך הראשי
    closeModal('modal1');
    closeModal('modal3');
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    
    document.getElementById('startProcessBtn').style.display = 'block';

    // הסתרת כפתורי הורדה והעתקה
    document.getElementById('downloadButton').style.display = 'none';
    document.getElementById('copyButton').style.display = 'none';

    // מחיקת תוכן תמלול מחולק לפי דוברים
    document.getElementById("segmentationResult").textContent = "";
    document.getElementById("intervieweeNameInput").value = "";

}