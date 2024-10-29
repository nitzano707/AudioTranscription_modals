// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית
let maxChunkSizeMB = 15; // גודל מקטע ברירת מחדל במגהבייט

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');

    // הסתרת אזור הזנת API או הצגת אזור העלאת קובץ וכפתור התחל תהליך
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }

    // הגדרת ברירת המחדל להצגת תמלול כטקסט
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
    const audioFileInput = document.getElementById('audioFile');
    audioFileInput.click();
}

// מאזין לאירוע שינוי ברכיב העלאת הקובץ
document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;

    // עדכון מצב כפתור "הבא"
    const uploadBtn = document.getElementById('uploadBtn');
    if (this.files[0]) {
        uploadBtn.disabled = false;
    } else {
        uploadBtn.disabled = true;
    }
});

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

async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    openModal('modal3'); // הצגת מודאל התקדמות עם אייקון טעינה
    console.log("Progress modal opened.");

    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        closeModal('modal3');
        return;
    }

    // בדיקה אם סוג הקובץ הוא MP3 והגדלת גודל המקטע
    if (audioFile.type === 'audio/mpeg') {
        maxChunkSizeMB = 2;
        console.log("File is MP3, setting maxChunkSizeMB to 2");
    } else {
        maxChunkSizeMB = 15;
        console.log("File is not MP3, using default maxChunkSizeMB of 15");
    }

    const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;
    let transcriptionData = [];

    try {
        console.log("Starting to split the audio file into chunks...");
        const chunks = await splitAudioToChunksBySize(audioFile, maxChunkSizeBytes);
        const totalChunks = chunks.length;
        console.log(`Total chunks created: ${totalChunks}`);

        for (let i = 0; i < totalChunks; i++) {
            const chunkFile = new File([chunks[i]], `chunk_${i + 1}.${audioFile.name.split('.').pop()}`, { type: audioFile.type });

            console.log("Uploading chunk", i + 1, "of", totalChunks);

            const progressPercent = Math.round(((i + 1) / totalChunks) * 100);
            document.getElementById('progress').style.width = `${progressPercent}%`;
            document.getElementById('progressText').textContent = `${progressPercent}%`;

            await processAudioChunk(chunkFile, transcriptionData, i + 1, totalChunks);

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        saveTranscriptions(transcriptionData, audioFile.name);
        console.log("All chunks processed, saving transcriptions.");
        displayTranscription('text');
        console.log("Displaying transcription.");

        // סגירת מודאל התקדמות ופתיחת מודאל התמלול
        closeModal('modal3'); // סגירת מודאל ההתקדמות
        openModal('modal4');  // פתיחת מודאל הצגת התמלול
    } catch (error) {
        console.error('Error during audio processing:', error);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
}

async function splitAudioToChunksBySize(file, maxChunkSizeBytes) {
    // אם הקובץ קטן מהגודל המרבי, החזר אותו במקטע אחד
    if (file.size <= maxChunkSizeBytes) {
        return [file];
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalSizeBytes = file.size;

    // חשב את מספר המקטעים הדרוש כך שכל מקטע לא יעלה על maxChunkSizeBytes
    const numberOfChunks = Math.ceil(totalSizeBytes / maxChunkSizeBytes);

    // חשב את משך הזמן לכל מקטע באופן פרופורציונלי
    const chunkDuration = audioBuffer.duration / numberOfChunks;
    if (chunkDuration <= 0) {
        console.error("Invalid chunk duration:", chunkDuration);
        throw new Error("Chunk duration must be greater than 0.");
    }

    let currentTime = 0;
    const chunks = [];

    while (currentTime < audioBuffer.duration) {
        const end = Math.min(currentTime + chunkDuration, audioBuffer.duration);
        const frameCount = Math.floor((end - currentTime) * sampleRate);

        // בדיקה אם מספר הפריימים תקין
        if (frameCount <= 0) {
            console.warn("Skipping chunk with invalid frame count:", frameCount);
            currentTime = end;
            continue;
        }

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
    formData.append('response_format', 'verbose_json'); // שימוש בפורמט JSON מפורט לקבלת חותמות זמן
    formData.append('language', defaultLanguage); // שימוש בשפת ברירת מחדל

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
                // יצירת SRT עבור כל משפט בנפרד
                data.segments.forEach((segment, index) => {
                    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
                        const startTime = formatTimestamp(segment.start);
                        const endTime = formatTimestamp(segment.end);
                        const text = segment.text.trim();

                        transcriptionData.push({
                            text: text,
                            timestamp: `${startTime} --> ${endTime}`
                        });
                    } else {
                        console.warn(`Invalid timestamp for segment ${index}:`, segment);
                    }
                });
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

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function saveTranscriptions(data, audioFileName) {
    transcriptionDataText = data.map((d, index) => {
        // בדיקה אם יש סימן פיסוק בסוף המקטע, במידה ואין נוסיף רווח
        if (/[.?!]$/.test(d.text.trim())) {
            return cleanText(d.text);
        } else {
            return cleanText(d.text) + " ";
        }
    }).join("").trim();

    // יצירת קובץ SRT עבור כל משפט בנפרד
    transcriptionDataSRT = data.map((d, index) => {
        return `${index + 1}\n${d.timestamp}\n${cleanText(d.text)}\n`;
    }).join("\n\n");

    console.log("Transcription data saved successfully:", transcriptionDataText);
}

function displayTranscription(format) {
    console.log("Displaying transcription in format:", format);
    let transcriptionResult;
    if (format === "text") {
        transcriptionResult = document.getElementById('textContent');
    } else if (format === "srt") {
        transcriptionResult = document.getElementById('srtContent');
    }

    if (!transcriptionResult) {
        console.error('Invalid tab name or element not found:', format);
        return;
    }

    // ווידוא שהכרטיסיה הרלוונטית מוצגת
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    if (format === "text") {
        transcriptionResult.textContent = transcriptionDataText;
    } else if (format === "srt") {
        transcriptionResult.textContent = transcriptionDataSRT;
    }

    transcriptionResult.parentElement.style.display = "block";
    console.log("Transcription displayed successfully.");
}

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

function restartProcess() {
    // סגירה של כל המודאלים הפעילים
    closeModal('modal4');  // סגור את המודאל האחרון
    closeModal('modal3');  // סגור את modal3 כדי שלא יישאר פתוח
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1'); // פתח את modal1 להתחלה מחדש
}
