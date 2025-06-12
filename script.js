const MAX_SEGMENT_SIZE_MB = 24; // גודל מקטע מקסימלי ב-MB

let estimatedTime = 0;
let transcriptionDataText = '';
let transcriptionDataSRT = '';
let audioFileName = '';
const defaultLanguage = 'he';
let totalElapsedTime = 0;
let firstChunkDuration = 0;
let apiKey = localStorage.getItem('groqApiKey');

// ממשק ראשוני
document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    const apiRequest = document.getElementById('apiRequest');
    const startProcessBtn = document.getElementById('startProcessBtn');
    const logoutButton = document.getElementById('logoutButton');

    if (!apiKey) {
        apiRequest.style.display = 'block';
        startProcessBtn.style.display = 'none';
        logoutButton.style.display = 'none';
        document.getElementById('apiKeyInput').focus();
    } else {
        apiRequest.style.display = 'none';
        startProcessBtn.style.display = 'block';
        logoutButton.style.display = 'inline-block';
    }

    document.getElementById('textTab').style.display = 'block';
    document.querySelector("button[onclick*='textTab']").classList.add('active');
    displayTranscription('text');
});

function logout() {
    const confirmation = window.confirm(
        "האם ברצונך להתנתק?\n" +
        "ניתן להתחבר שוב עם אותו API Key או להפיק API Key חדש מאתר Groq.\n" +
        "ההגדרות הנוכחיות לא יישמרו."
    );
    if (confirmation) {
        localStorage.removeItem('groqApiKey');
        document.getElementById('apiRequest').style.display = 'block';
        document.getElementById('startProcessBtn').style.display = 'none';
        document.getElementById('logoutButton').style.display = 'none';
        document.getElementById('apiKeyInput').focus();
        alert('התנתקת בהצלחה! תוכל להזין API Key חדש כדי להמשיך.');
    }
}

function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput').value;
    if (apiKeyInput) {
        localStorage.setItem('groqApiKey', apiKeyInput);
        apiKey = apiKeyInput;
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
        document.getElementById('uploadBtn').classList.add('start-over');
    } else {
        document.getElementById('fileName').textContent = "לא נבחר קובץ";
        document.getElementById('uploadBtn').disabled = true;
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
   const isMP4 = fileType.includes('mp4') || fileExtension === 'mp4';
   const sizeInMB = audioFile.size / (1024 * 1024);

   if (isM4A && sizeInMB > MAX_SEGMENT_SIZE_MB) {
       alert(`קבצי M4A חייבים להיות קטנים מ-${MAX_SEGMENT_SIZE_MB}MB. אנא העלה קובץ קטן יותר או השתמש בפורמט MP3/WAV.`);
       document.getElementById('audioFile').value = ""; 
       document.getElementById('fileName').textContent = "לא נבחר קובץ";
       document.getElementById('uploadBtn').disabled = true;
       return;
   }

    if (isMP4 && sizeInMB > MAX_SEGMENT_SIZE_MB) {
       alert(`קבצי MP4 חייבים להיות קטנים מ-${MAX_SEGMENT_SIZE_MB}MB. אנא העלה קובץ קטן יותר או השתמש בפורמט MP3/WAV.`);
       document.getElementById('audioFile').value = ""; 
       document.getElementById('fileName').textContent = "לא נבחר קובץ";
       document.getElementById('uploadBtn').disabled = true;
       return;
   }

   if (!fileType.includes('mp3') && 
       !fileType.includes('wav') && 
       !fileType.includes('m4a') && 
       !fileType.includes('mp4') &&
       !fileExtension === 'mp3' && 
       !fileExtension === 'wav' && 
       !fileExtension === 'mp4' &&
       !fileExtension === 'm4a') {
       alert('פורמט קובץ לא נתמך. אנא השתמש בקובץ בפורמט MP3 | WAV | M4A |.');
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

   // הערכת משך
   let estimatedDurationInMinutes;
   if (fileType.includes('mp3') || fileExtension === 'mp3') {
       estimatedDurationInMinutes = (sizeInMB / 0.96);
   } else if (fileType.includes('wav') || fileExtension === 'wav') {
       estimatedDurationInMinutes = (sizeInMB / 10);
   } else if (isM4A || isMP4) {
       estimatedDurationInMinutes = (sizeInMB / 0.75);
   }
   if (estimatedDurationInMinutes > 120) {
       alert(`משך הקובץ מוערך כ-${Math.round(estimatedDurationInMinutes)} דקות, ייתכן שהוא יחרוג ממכסת התמלול של 120 דקות לשעה. אנא היוועץ אם להמשיך.`);
   }

   const maxChunkSizeBytes = MAX_SEGMENT_SIZE_MB * 1024 * 1024;
   let transcriptionData = [];
   let totalTimeElapsed = 0;

   try {
       console.log("Starting to split the audio file into chunks...");
       const chunks = await splitAudioFileToWavChunks(audioFile, maxChunkSizeBytes);
       const totalChunks = chunks.length;
       console.log(`Total chunks created: ${totalChunks}`);

       for (let i = 0; i < totalChunks; i++) {
           const chunkFile = new File([chunks[i]], `chunk_${i + 1}.wav`, { type: "audio/wav" });
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




// פיצול קובץ אודיו (MP3/WAV) ל-chunks בפורמט WAV בלבד
async function splitAudioFileToWavChunks(file, maxChunkSizeBytes) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // טיפול במקרה של Blob שכבר WAV (בפיצול חוזר)
    let arrayBuffer;
    try {
        arrayBuffer = await file.arrayBuffer();
    } catch (e) {
        console.warn("בעיה בקריאת blob לאודיו:", e);
        return [];
    }
    let audioBuffer;
    try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
        console.warn("בעיה בדיקוד קובץ אודיו. כנראה שה-blob קטן או לא תקני:", e);
        return [];
    }
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalDuration = audioBuffer.duration;

    // הגנה: לא מפצלים אם משך האודיו אפס
    if (totalDuration === 0) {
        console.warn("אורך קובץ אודיו אפס – אין מה לפצל.");
        return [];
    }

    let estimatedChunkDuration = (maxChunkSizeBytes / (sampleRate * numChannels * 2));
    if (estimatedChunkDuration <= 0.1) estimatedChunkDuration = 1; // הגנה – לא ליצור chunks של אפס שניות
    const numberOfChunks = Math.ceil(totalDuration / estimatedChunkDuration);
    const chunkDuration = totalDuration / numberOfChunks;

    let currentTime = 0;
    const chunks = [];
    while (currentTime < totalDuration) {
        const end = Math.min(currentTime + chunkDuration, totalDuration);

        // הגנה: דילוג על מקטעים ריקים/מינימליים
        if (end <= currentTime || (end - currentTime) < 0.01) {
            break;
        }

        const frameCount = Math.floor((end - currentTime) * sampleRate);
        if (frameCount <= 0) {
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
        if (blob.size > maxChunkSizeBytes) {
            const subChunks = await splitAudioFileToWavChunks(blob, maxChunkSizeBytes);
            chunks.push(...subChunks);
        } else {
            chunks.push(blob);
        }
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
    setUint32(16);
    setUint16(1);
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
    const title = `תמלול קובץ אודיו: ${audioFileName}  :בוצע באמצעות https://tamleli.netlify.app\n\n`;
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

    navigator.clipboard.writeText(textToCopy).then(() => {
        const copyMessage = document.getElementById('copyMessage');
        if (copyMessage) {
            copyMessage.style.display = 'block';
            setTimeout(() => {
                copyMessage.style.display = 'none';
            }, 2000);
        } else {
            console.warn("copyMessage element not found in the DOM.");
        }
    }).catch((error) => {
        console.error('Failed to copy text:', error);
        alert('שגיאה בהעתקת הטקסט. נא לנסות שוב.');
    });
}

function downloadTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט מתמלול.');
        return;
    }
    const format = activeTab.getAttribute('data-format');
    let blob, fileName;

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
    const downloadLink = document.getElementById('downloadLink');
    downloadLink.href = url;
    downloadLink.download = fileName;
    downloadLink.click();
    URL.revokeObjectURL(url);
}

function resetProcess() {
    estimatedTime = 0;
    audioFileName = '';
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    totalElapsedTime = 0;
    firstChunkDuration = 0;

    closeModal('modal1');
    closeModal('modal3');
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('startProcessBtn').style.display = 'block';
}

function calculateEstimatedTime() {
    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) return;
    const sizeMB = audioFile.size / (1024 * 1024);
    if (audioFile.type.includes('mp3')) {
        estimatedTime = sizeMB * 1;
    } else if (audioFile.type.includes('wav')) {
        estimatedTime = sizeMB * 0.4;
    } else {
        estimatedTime = sizeMB * 1.5;
    }
}

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

// -------- פונקציות ממשק כללי --------

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
    const format = evt.currentTarget.getAttribute('data-format');
    displayTranscription(format);
}

// -------- פונקציות סגמנטציה לחלוקה לפי דוברים --------

function showSpeakerSegmentationModal() {
    openModal('speakerSegmentationModal');
}

async function startSpeakerSegmentation() {
    let intervieweeName = document.getElementById('intervieweeNameInput').value.trim();
    if (!intervieweeName) {
        intervieweeName = "מרואיין";
    }

    const transcriptionText = transcriptionDataText;
    const segments = splitTextIntoSegments(transcriptionText);
    let fullResult = "";
    document.getElementById("segmentationResult").textContent = "מתחיל בעיבוד התמלול...\n\n";

    for (const segment of segments) {
        const prompt = `חלק את הטקסט הבא לפי דוברים - "מראיין" ו-"${intervieweeName}". אל תדלג על שום מילה מהטקסט המקורי שאשלח לך. השתמש באסטרטגיות הבאות כדי להבחין ביניהם:- אם המשפט מכיל סימן שאלה, או מנוסח כשאלה, התייחס אליו כדבריו של המראיין.
- קטעים ארוכים ומפורטים או כאלו הכוללים מידע אישי ומתארים חוויות – התייחס אליהם כדברי ${intervieweeName}.
- כאשר מופיעים ביטויים כמו "ספרי לנו", "הסבר", או פניות דומות, ראה בכך אינדיקציה לכך שמדובר בדברי המראיין.
- במקרים בהם שם המרואיין מופיע בתוך הטקסט, זהו רמז להפרדת דבריו מהשאלות של המראיין.
- שים לב לשימוש במגדר בצורת הפעלים: אם המגדר של המראיין והמרואיין שונים, צורת הפעלים יכולה לעזור לזהות את הדובר, כאשר המראיין או המרואיין מדברים בהתאם למגדרם.
- שמור על רצף הדובר, כך שכל דובר ממשיך את דבריו ללא תוויות חוזרות מיותרות.
- בדוק את עצמך היטב שאתה לא מדלג על אף מילה מהטקסט המקורי שנשלח אליך.
- אם מופיעה מילה שנראית שגויה או לא תקנית, השאר אותה כפי שהיא והצג תיקון מוצע בסוגריים מרובעים מיד אחריה. לדוגמה: "השיקונים [השיקולים]". התמקד בתיקון מילים שאינן מתאימות להקשר המשפט או נראות שגויות מבחינה לשונית.
- אל תוסיף שום טקסט או תו כלשהו (כמו למשל "Here is the divided text:") לפני או אחרי הטקסט שאתה מחזיר.
החזר את הטקסט כשהוא מפוצל לפי דוברים, עם התיקונים המוצעים בלבד בסוגריים מרובעים, ללא טקסט נוסף לפני או אחרי:\n\n${segment}`;

        try {
            const result = await getSegmentedText(segment, prompt, intervieweeName);
            fullResult += result.replace(/(מראיין:|מרואיין:|${intervieweeName}:)/g, "\n$1") + "\n\n";
            document.getElementById("segmentationResult").textContent = fullResult;
        } catch (error) {
            console.error("Error with segment:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    fullResult += "\n\n---\nסוף תמלול";
    document.getElementById("segmentationResult").textContent = fullResult;

    document.getElementById("copyButton").style.display = "block";
    document.getElementById("downloadButton").style.display = "block";
}

async function getSegmentedText(text, prompt) {
    let success = false;
    const maxRetries = 5;
    let retries = 0;

    while (!success && retries < maxRetries) {
        if (!apiKey) {
            throw new Error("API Key not found in local storage.");
        }
        try {
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

            if (response.ok) {
                const result = await response.json();
                success = true;
                let segmentedText = result.choices[0].message.content;
                segmentedText = segmentedText.replace(/(מראיין:|מרואיין:)/g, "\n$1");
                return segmentedText;
            } else {
                const errorText = await response.text();
                const errorData = JSON.parse(errorText);

                if (errorData.error && errorData.error.code === "rate_limit_exceeded") {
                    const waitTime = extractWaitTime(errorText);
                    if (waitTime) {
                        console.log(`מגבלת קצב הושגה. ממתין ${waitTime} שניות לפני ניסיון נוסף...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    } else {
                        retries++;
                    }
                } else {
                    throw new Error(`שגיאה בבקשה: ${errorText}`);
                }
            }
        } catch (error) {
            console.error("Error with segment:", error);
            retries++;
        }
    }

    throw new Error("לא ניתן היה לבצע חלוקה לדוברים לאחר ניסיונות מרובים.");
}

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

function restartProcess() {
    estimatedTime = 0;
    audioFileName = '';
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    totalElapsedTime = 0;
    firstChunkDuration = 0;

    closeModal('modal1');
    closeModal('modal3');
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('startProcessBtn').style.display = 'block';

    document.getElementById('downloadButton').style.display = 'none';
    document.getElementById('copyButton').style.display = 'none';

    document.getElementById("segmentationResult").textContent = "";
    document.getElementById("intervieweeNameInput").value = "";
}
