// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית
let apiKey = localStorage.getItem('groqApiKey');
const chunkSize = 24 * 1024 * 1024; // גודל מקטע 24MB
const modelType = 'whisper-large-v3'; // מודל תמלול מותאם מהדוגמה

document.addEventListener('DOMContentLoaded', () => {
    // בדיקה אם יש API Key שמור, והצגת הממשק בהתאם
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

// פונקציה לפתיחת מודאל
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
}

// פונקציה לסגירת מודאל
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

// שמירת API Key
function saveApiKey() {
    const inputApiKey = document.getElementById('apiKeyInput').value.trim();
    if (inputApiKey) {
        localStorage.setItem('groqApiKey', inputApiKey);
        apiKey = inputApiKey;
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
        alert('ה-API Key נשמר בהצלחה!');
    } else {
        alert('אנא הזן API Key תקין');
    }
}

// העלאת קובץ אודיו
function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

// הצגת שם קובץ לאחר בחירה
document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !this.files[0];
});

// פונקציה לפיצול קובץ האודיו לחלקים
async function splitAudioFile(file) {
    if (!(file instanceof Blob)) {
        throw new TypeError("הקובץ אינו מסוג Blob או File.");
    }
    
    const totalChunks = Math.ceil(file.size / chunkSize);
    const audioChunks = [];

    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, file.size);
        const chunk = file.slice(start, end);
        audioChunks.push(new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, { type: file.type }));
    }

    return audioChunks;
}

// תמלול חלק של קובץ אודיו
async function transcribeChunk(chunk) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', modelType);
    formData.append('response_format', 'verbose_json');
    formData.append('language', defaultLanguage);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`שגיאה: ${response.status}, פרטים: ${errorText}`);
    }

    return await response.json();
}

// פונקציה עיקרית לתמלול קובץ האודיו
async function uploadAudio() {
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    openModal('modal3'); // הצגת מודאל התקדמות
    transcriptionDataText = '';
    transcriptionDataSRT = '';

    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        closeModal('modal3');
        return;
    }

    try {
        const audioChunks = await splitAudioFile(audioFile);
        let allSegments = [];

        for (let i = 0; i < audioChunks.length; i++) {
            const progressPercent = Math.round(((i + 1) / audioChunks.length) * 100);
            document.getElementById('progress').style.width = `${progressPercent}%`;
            document.getElementById('progressText').textContent = `${progressPercent}%`;

            const chunkResult = await transcribeChunk(audioChunks[i]);
            allSegments = allSegments.concat(chunkResult.segments);
        }

        saveTranscriptions(allSegments);
        closeModal('modal3');
        openModal('modal4'); // הצגת מודאל עם תמלול סופי
        alert('התמלול הושלם בהצלחה!');
    } catch (error) {
        console.error('שגיאה בתמלול:', error);
        alert('שגיאה בתמלול. נא לבדוק את ה-API Key ולנסות שוב.');
        closeModal('modal3');
    }
}

// פונקציה לעיצוב חותמות זמן בפורמט SRT
function formatTimestamp(seconds) {
    const date = new Date(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${secs},${millis}`;
}

// שמירת תמלול בפורמטים שונים
function saveTranscriptions(segments) {
    transcriptionDataText = segments.map((segment) => segment.text).join(" ");
    transcriptionDataSRT = segments.map((segment, index) => {
        const startTime = formatTimestamp(segment.start);
        const endTime = formatTimestamp(segment.end);
        return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n`;
    }).join("\n");

    document.getElementById('textContent').textContent = transcriptionDataText;
    document.getElementById('srtContent').textContent = transcriptionDataSRT;
}

// הצגת תמלול בהתאם לפורמט
function displayTranscription(format) {
    document.getElementById('textContent').style.display = (format === 'text') ? 'block' : 'none';
    document.getElementById('srtContent').style.display = (format === 'srt') ? 'block' : 'none';
}

// הצגת כרטיסיה שנבחרה
function openTab(evt, tabName) {
    displayTranscription(tabName);
    document.querySelectorAll('.tablinks').forEach(tab => tab.classList.remove('active'));
    evt.currentTarget.classList.add('active');
}

// הורדת התמלול כקובץ
function downloadTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט מתמלול.');
        return;
    }
    const format = activeTab.getAttribute('data-format');
    let blob, fileName;

    if (format === "text") {
        blob = new Blob([transcriptionDataText], { type: 'text/plain' });
        fileName = 'transcription.txt';
    } else if (format === "srt") {
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

// התחלת תהליך מחדש
function restartProcess() {
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
}
