document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');

    // הסתרת אזור הזנת API או הצגת אזור העלאת קובץ
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
    }
});

function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput').value;
    if (apiKeyInput) {
        localStorage.setItem('groqApiKey', apiKeyInput);
        document.getElementById('apiRequest').style.display = 'none';
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
    document.getElementById('modal3').innerHTML += '<div class="loading-icon">(אייקון טעינה)</div>'; // הוספת אייקון טעינה

    const audioFile = document.getElementById('audioFile').files[0];
    const language = document.getElementById('languageSelect').value;
    const progressBar = document.getElementById('progress');
    const progressText = document.getElementById('progressText');

    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
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
            
            const progressPercent = Math.round(((i + 1) / totalChunks) * 100);
            progressBar.style.width = `${progressPercent}%`;
            progressText.textContent = `${progressPercent}%`;

            await processAudioChunk(chunkFile, transcriptionData, i + 1, totalChunks, progressBar);

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        displayTranscription({ segments: transcriptionData }, audioFile.name);
    } catch (error) {
        console.error('Error during audio processing:', error);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
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

async function processAudioChunk(chunk, transcriptionData, currentChunk, totalChunks, progressBar) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
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
            const data = await response.json();
            transcriptionData.push(...data.segments);
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

function displayTranscription(data, audioFileName) {
    closeModal('modal3');
    openModal('modal4');

    const transcriptionResult = document.getElementById('transcriptionResult');
    let htmlContent = '';
    data.segments.forEach(segment => {
        htmlContent += `<p><strong>${formatTime(segment.start)}</strong>: ${segment.text}</p>`;
    });
    transcriptionResult.innerHTML = htmlContent;

    // שמירת שם קובץ האודיו להורדה
    transcriptionResult.setAttribute('data-audio-file-name', audioFileName);
}

function formatTime(seconds) {
    const ms = Math.floor((seconds % 1) * 10).toString().padStart(1, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const m = Math.floor((seconds / 60) % 60).toString().padStart(2, '0');
    return `${m}:${s}.${ms}`;
}

function downloadTranscription() {
    const transcriptionResult = document.getElementById('transcriptionResult').innerText;
    const audioFileName = document.getElementById('transcriptionResult').getAttribute('data-audio-file-name') || 'audio';
    const sanitizedFileName = audioFileName.replace(/\./g, '_').toLowerCase();
    const textContent = `תמלול של קובץ אודיו: ${sanitizedFileName}\n\n${transcriptionResult}`;
    const blob = new Blob([textContent], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Trans_${sanitizedFileName}.txt`;
    link.click();
}

function restartProcess() {
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1'); // חזרה למודל העלאת קובץ
}

// סגירת מודאל בלחיצה מחוץ לתוכן
window.onclick = function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let i = 0; i < modals.length; i++) {
        if (event.target == modals[i]) {
            closeModal(modals[i].id);
        }
    }
};
