
// משתנים גלובליים
const MAX_SEGMENT_SIZE_MB = 25; // גודל מקטע מקסימלי ב-MB

// משתנים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית

// המשתנה global שנצבר עם הזמן המצטבר הכולל בכל מקטע
let totalElapsedTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
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
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !this.files[0];
});

async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }
    openModal('modal3');
    const audioFile = document.getElementById('audioFile').files[0];
    document.getElementById('modal3').querySelector('.modal-header').textContent = `התמלול מתבצע עבור הקובץ: ${audioFile.name}`;
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        closeModal('modal3');
        return;
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
            const progressPercent = Math.round(((i + 1) / totalChunks) * 100);
            document.getElementById('progress').style.width = `${progressPercent}%`;
            document.getElementById('progressText').textContent = `${progressPercent}%`;

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
    } catch (error) {
        console.error('Error during audio processing:', error);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
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
        chunks.push(blob);
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
        chunks.push(file.slice(start, end));
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
    transcriptionDataText = data.map(d => cleanText(d.text)).join(" ").trim();
    transcriptionDataSRT = data.map((d, index) => {
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

    if (format === "text") {
        if (!transcriptionDataText) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataText], { type: 'text/plain' });
        fileName = 'transcription.txt';
    } else if (format === "srt") {
        if (!transcriptionDataSRT) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataSRT], { type: 'text/plain' });
        fileName = 'transcription.srt';
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

// פונקציה לאיפוס תהליך ההעלאה והתמלול
function restartProcess() {
    // סגירה של כל המודלים הפעילים
    closeModal('modal4');  // סגירת מודל התמלול
    closeModal('modal3');  // סגירת מודל ההתקדמות
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1'); // פתיחת מודל ההתחלה
}
