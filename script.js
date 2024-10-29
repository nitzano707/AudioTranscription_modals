// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataJson = '';
let transcriptionDataVerboseJson = '';

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');

    // הסתרת אזור הזנת API או הצגת אזור העלאת קובץ וכפתור התחל תהליך
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
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

    const maxChunkSizeMB = 24;
    const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;
    let transcriptionData = [];

    try {
        const chunks = await splitAudioToChunksBySize(audioFile, maxChunkSizeBytes);
        const totalChunks = chunks.length;

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

        // סגירת מודאל התקדמות ואפשרויות תמלול, ופתיחת מודאל התמלול
        closeModal('modal3'); // סגירת מודאל ההתקדמות
        closeModal('modal2'); // סגירת מודאל בחירת אפשרויות תמלול
        openModal('modal4');  // פתיחת מודאל הצגת התמלול
    } catch (error) {
        console.error('Error during audio processing:', error);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
}

async function splitAudioToChunksBySize(file, maxChunkSizeBytes) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const chunkDuration = maxChunkSizeBytes / (sampleRate * numChannels * 2);
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
    formData.append('response_format', 'json'); // ודא שאתה מבקש פורמט JSON
    formData.append('language', 'he');

    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין שוב.');
        location.reload();
        return;
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.ok) {
            try {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    const data = await response.json();
                    if (data.text) {
                        transcriptionData.push(data.text);
                    } else {
                        console.warn(`Missing text in response for chunk ${currentChunk}`);
                    }
                } else {
                    const responseText = await response.text();
                    console.warn(`Expected JSON response but got: ${contentType}`);
                    console.log("Response content:", responseText);
                }
            } catch (jsonError) {
                console.error('Error parsing JSON:', jsonError);
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

function saveTranscriptions(data, audioFileName) {
    transcriptionDataText = data.join("\n");
    transcriptionDataJson = { transcriptions: data };
    transcriptionDataVerboseJson = JSON.stringify({ transcriptions: data }, null, 2);
    console.log("Transcription data saved successfully:", transcriptionDataText);
}

function displayTranscription(format) {
    console.log("Displaying transcription in format:", format);
    let transcriptionResult = document.getElementById('transcriptionResult');
    if (!transcriptionResult) {
        transcriptionResult = document.createElement('div');
        transcriptionResult.id = 'transcriptionResult';
        document.getElementById('modal4').appendChild(transcriptionResult);
    }
    
    if (format === "text") {
        transcriptionResult.textContent = transcriptionDataText;
    } else if (format === "json") {
        transcriptionResult.textContent = JSON.stringify(transcriptionDataJson, null, 2);
    } else if (format === "verbose_json") {
        transcriptionResult.textContent = transcriptionDataVerboseJson;
    }
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
}

function downloadTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט מתמלול.');
        return;
    }
    const format = activeTab.textContent.trim().toLowerCase().replace(' ', '_');
    let blob, fileName;

    if (format === "text") {
        if (!transcriptionDataText) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataText], { type: 'text/plain' });
        fileName = 'transcription.txt';
    } else if (format === "json") {
        if (!transcriptionDataJson) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([JSON.stringify(transcriptionDataJson, null, 2)], { type: 'application/json' });
        fileName = 'transcription.json';
    } else if (format === "verbose_json") {
        if (!transcriptionDataVerboseJson) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataVerboseJson], { type: 'application/json' });
        fileName = 'transcription_verbose.json';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function restartProcess() {
    // סגירה של כל המודאלים הפעילים
    closeModal('modal4');  // סגור את המודאל האחרון
    closeModal('modal2');  // סגור את modal2 כדי שלא יישאר פתוח
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1'); // פתח את modal1 להתחלה מחדש
}

/*
// סגירת מודאל בלחיצה מחוץ לתוכן
window.onclick = function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let i = 0; i < modals.length; i++) {
        if (event.target == modals[i]) {
            closeModal(modals[i].id);
        }
    }
};
*/
