const MAX_SEGMENT_SIZE_MB = 24; // גודל מקטע מקסימלי ב-MB
const MAX_CHUNK_SIZE_BYTES = MAX_SEGMENT_SIZE_MB * 1024 * 1024;

// מצב גלובלי משופר
let globalState = {
    estimatedTime: 0,
    transcriptionDataText: '',
    transcriptionDataSRT: '',
    audioFileName: '',
    totalElapsedTime: 0, // המפתח למניעת סחף זמן
    apiKey: localStorage.getItem('groqApiKey'),
    defaultLanguage: 'he',
};

// ממשק ראשוני
document.addEventListener('DOMContentLoaded', () => {
    const { apiKey } = globalState;
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
        globalState.apiKey = null; // עדכון המצב הגלובלי
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
        globalState.apiKey = apiKeyInput; // עדכון המצב הגלובלי
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
        document.getElementById('logoutButton').style.display = 'inline-block'; // הצגת כפתור התנתקות
    }
}

function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    if (this.files[0]) {
        globalState.audioFileName = this.files[0].name; // עדכון המצב הגלובלי
        document.getElementById('fileName').textContent = fileName;
        document.getElementById('uploadBtn').disabled = false;
        document.getElementById('uploadBtn').classList.add('start-over');
    } else {
        globalState.audioFileName = ''; // עדכון המצב הגלובלי
        document.getElementById('fileName').textContent = "לא נבחר קובץ";
        document.getElementById('uploadBtn').disabled = true;
        document.getElementById('uploadBtn').classList.remove('start-over');
    }
});


// --------------------------------------------------------------------------------------
//
// 🛠️ פונקציות פיצול MP3
//
// --------------------------------------------------------------------------------------

function findNextMp3FrameHeader(data, startOffset) {
    // דלג על אפסים
    while (startOffset < data.length - 1 && data[startOffset] === 0x00) {
        startOffset++;
    }
    // חפש כותרת פריים: 11 ביטים דלוקים (0xFF) ושלושה ביטים ראשונים בבייט הבא (0xE0)
    for (let i = startOffset; i < data.length - 1; i++) {
        if (data[i] === 0xFF && (data[i + 1] & 0xE0) === 0xE0) {
            return i;
        }
    }
    return null;
}

// פונקציה לדלג על ID3v2 Tags (חיוני לחוסן הפיצול)
function findId3v2Size(data) {
    // בודק אם מתחיל ב-ID3 (הדרה ראשונה)
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
        // גודל ה-Tag: 4 בתים, כאשר רק 7 ביטים משמשים מכל בייט (Synchsafe integers)
        const sizeByte1 = data[6];
        const sizeByte2 = data[7];
        const sizeByte3 = data[8];
        const sizeByte4 = data[9];
        
        const size = (sizeByte1 << 21) | (sizeByte2 << 14) | (sizeByte3 << 7) | sizeByte4;
        return size + 10; // גודל התוכן + גודל הכותרת (10 בתים)
    }
    return 0; // לא נמצא
}

async function splitMp3ByFrameHeaders(file, maxChunkSizeBytes) {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const chunks = [];
    let start = 0;

    // 1. דלג על ID3 Tag בתחילת הקובץ
    start += findId3v2Size(data);

    while (start < data.length) {
        // ודא שההתחלה הנוכחית היא על כותרת פריים תקנית
        start = findNextMp3FrameHeader(data, start) || start;

        // קבע את נקודת הסיום המקסימלית המותרת
        let end = Math.min(start + maxChunkSizeBytes, data.length);
        
        // 2. חפש כותרת פריים קרובה לסוף כדי לפצל בצורה נקייה
        let nextHeader = findNextMp3FrameHeader(data, end);

        // אם יש Header קרוב קדימה, קפוץ אליו כדי למנוע חיתוך באמצע פריים.
        // הגדלנו את החיפוש ל-20KB כדי לא לפספס Headers רחוקים מעט.
        if (nextHeader && nextHeader - end < 20000) { 
            end = nextHeader;
        }

        const chunkData = data.slice(start, end);

        // 3. הוסף את המקטע ואת משך הזמן המשוער
        chunks.push({
            file: new Blob([chunkData], { type: 'audio/mp3' }),
            duration: null, // אין לנו את משך הזמן האמיתי של ה-MP3 בצד לקוח
        });
        
        console.log(`Chunk ${chunks.length}: bytes ${start} - ${end}, size: ${((end - start)/1024/1024).toFixed(2)} MB`);
        start = end;
        
        // הגנה: ודא שיש התקדמות
        if (start === end && start < data.length) {
             start++; // אם נתקעים, קפוץ בייט אחד כדי למנוע לולאה אינסופית
        }
    }
    console.log("Total MP3 chunks created:", chunks.length);
    return chunks; // מחזיר מערך של {file, duration}
}


// --------------------------------------------------------------------------------------
//
// 🛠️ פונקציות פיצול WAV (WAV, M4A, MP4)
//
// --------------------------------------------------------------------------------------

async function splitAudioFileToWavChunks(file, maxChunkSizeBytes) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    let audioBuffer;

    try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
        console.error("בעיה בדיקוד קובץ אודיו. הקובץ כנראה פגום או בפורמט לא נתמך (לאחר M4A/MP4):", e);
        return []; // מחזיר מערך ריק במקרה של כשלון
    }

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalFrames = audioBuffer.length;
    
    // חישוב מדויק של מספר ה-Frames המקסימלי ל-Chunk
    const bytesPerFrame = numChannels * 2; 
    const maxFramesPerChunk = Math.floor(maxChunkSizeBytes / bytesPerFrame);
    
    // מספר המקטעים הדרוש
    const numberOfChunks = Math.ceil(totalFrames / maxFramesPerChunk);
    const chunkFrames = Math.ceil(totalFrames / numberOfChunks);

    const chunks = [];
    let currentFrame = 0;
    while (currentFrame < totalFrames) {
        const endFrame = Math.min(currentFrame + chunkFrames, totalFrames);
        const frameCount = endFrame - currentFrame;
        
        if (frameCount <= 0) {
            break; 
        }

        // צור AudioBuffer חדש עבור המקטע
        const chunkBuffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);
        
        // העתקת הנתונים
        for (let channel = 0; channel < numChannels; channel++) {
            const originalChannelData = audioBuffer.getChannelData(channel);
            const chunkChannelData = chunkBuffer.getChannelData(channel);
            
            for (let i = 0; i < frameCount; i++) {
                chunkChannelData[i] = originalChannelData[currentFrame + i];
            }
        }
        
        // 1. צור את ה-WAV Blob ושמור את משך הזמן האמיתי
        const blob = bufferToWaveBlob(chunkBuffer);
        const actualDuration = frameCount / sampleRate;

        // הוספת המקטע עם משך הזמן המדויק
        chunks.push({
            file: blob,
            duration: actualDuration
        });
        
        console.log(`WAV Chunk ${chunks.length}: duration ${actualDuration.toFixed(2)}s, size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        
        currentFrame = endFrame;
    }
    return chunks; // מחזיר מערך של {file, duration}
}

// פונקציית הקידוד ל-WAV (נשארת ללא שינוי, היא תקינה)
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

// --------------------------------------------------------------------------------------
//
// 📈 פונקציה ראשית לתמלול (מעודכנת לטפל ב-Chunks עם Duration)
//
// --------------------------------------------------------------------------------------

async function uploadAudio() {
    const audioFile = document.getElementById('audioFile').files[0];
    const apiKey = globalState.apiKey;

    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        return;
    }
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }
    
    resetProcess(); // איפוס לפני תחילת תהליך חדש
    
    const fileType = audioFile.type.toLowerCase();
    const fileExtension = audioFile.name.split('.').pop().toLowerCase();
    const isMP3 = fileType.includes('mp3') || fileExtension === 'mp3';
    const isWAV = fileType.includes('wav') || fileExtension === 'wav';
    const isM4A = fileType.includes('m4a') || fileExtension === 'm4a';
    const isMP4 = fileType.includes('mp4') || fileExtension === 'mp4';

    // חסום קבצים לא נתמכים
    if (!isMP3 && !isWAV && !isM4A && !isMP4) {
        alert('פורמט קובץ לא נתמך. נא להעלות MP3, WAV, M4A או MP4.');
        return;
    }

    calculateEstimatedTime(audioFile);

    openModal('modal3');
    const modal = document.getElementById('modal3');
    if (modal) {
        const modalBody = modal.querySelector('.modal-body p');
        if (modalBody) {
            modalBody.innerHTML = `ברגעים אלה הקובץ <strong>${globalState.audioFileName}</strong> עולה ועובר תהליך עיבוד. בסיום התהליך יוצג התמלול.`;
        }
    }

    let transcriptionData = [];
    let chunks = [];
    
    try {
        // === פיצול ===
        if (isMP3) {
            if (audioFile.size > MAX_CHUNK_SIZE_BYTES) {
                console.log("Splitting MP3 file into chunks by frame header...");
                chunks = await splitMp3ByFrameHeaders(audioFile, MAX_CHUNK_SIZE_BYTES);
            } else {
                console.log("MP3 small enough – sending as single chunk.");
                chunks.push({ file: audioFile, duration: null });
            }
        }
        
        else if (isWAV || isM4A || isMP4) {
             if (audioFile.size > MAX_CHUNK_SIZE_BYTES) {
                console.log("Splitting non-MP3 file into WAV chunks...");
                chunks = await splitAudioFileToWavChunks(audioFile, MAX_CHUNK_SIZE_BYTES);
            } else {
                console.log("Non-MP3 small enough – converting to WAV chunk.");
                
                // קבצים קטנים מומרים ל-WAV כדי לקבל משך זמן מדויק, למעט WAV
                const wavChunks = await splitAudioFileToWavChunks(audioFile, audioFile.size);
                if (wavChunks.length === 1) {
                    chunks = wavChunks;
                } else if (isWAV) {
                    // אם WAV קטן, נשלח אותו ישירות (אם ה-WAV chunking נכשל על קטן, זה מוזר, נשתמש במקור)
                    chunks.push({ file: audioFile, duration: null });
                } else {
                    // גיבוי למקרה של M4A/MP4 קטן שלא עבר המרה תקינה
                     chunks.push({ file: audioFile, duration: null });
                }
            }
        }
        
        if (chunks.length === 0) {
            throw new Error("לא ניתן היה לפצל או להכין את קובץ האודיו לעיבוד.");
        }
        
        // === עיבוד מצטבר ===
        const totalChunks = chunks.length;
        globalState.totalElapsedTime = 0; // ודא איפוס

        for (let i = 0; i < totalChunks; i++) {
            const chunk = chunks[i];
            const currentChunk = i + 1;
            
            updateProgressBarSmoothly(currentChunk, totalChunks, globalState.estimatedTime);
            
            // קביעת הסיומת לפי ה-MIME type של ה-Blob
            // כל ה-non-MP3 הפכו ל-WAV, לכן זה או MP3 או WAV
            const fileExtension = chunk.file.type.includes('mp3') ? 'mp3' : 'wav';

            // 2. שולח את משך הזמן האמיתי יחד עם המקטע והסיומת
            await processAudioChunk(chunk.file, transcriptionData, currentChunk, totalChunks, chunk.duration, fileExtension); 
            
            // המתן חצי שנייה בין שליחת בקשות API
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        saveTranscriptions(transcriptionData, globalState.audioFileName);
        displayTranscription('text');
        closeModal('modal3');
        openModal('modal4');
        const modal4 = document.getElementById('modal4');
        if (modal4) {
            const modalBody = modal4.querySelector('.modal-body p');
            if (modalBody) {
                modalBody.innerHTML = `תמלול הקובץ <strong>${globalState.audioFileName}</strong> הושלם. זמן מצטבר סופי: ${globalState.totalElapsedTime.toFixed(2)} שניות.`;
            }
        }
    } catch (error) {
        console.error('Error during audio processing:', error);
        closeModal('modal3');
        alert('שגיאה במהלך התמלול. נא לנסות שוב.\n' + error.message);
        resetProcess();
    }
}


// --------------------------------------------------------------------------------------
//
// ⚡️ עיבוד מקטע (התיקון הקריטי ל-400 Bad Request ולסחף זמן)
//
// --------------------------------------------------------------------------------------

// הוספת fileExtension כפרמטר חדש
async function processAudioChunk(chunk, transcriptionData, currentChunk, totalChunks, durationParam, fileExtension) {
    const formData = new FormData();
    
    // **התיקון הקריטי ל-400 Bad Request:** ציון שם קובץ מפורש עם סיומת נכונה!
    const fileName = `chunk_${currentChunk}.${fileExtension}`; 
    formData.append('file', chunk, fileName); // הוספת שם הקובץ כארגומנט שלישי

    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'verbose_json');

    const apiKey = globalState.apiKey;

    if (!apiKey) {
        alert('מפתח API חסר. נא להזין שוב.');
        location.reload();
        return;
    }

    try {
        console.log(`Sending chunk ${currentChunk} of ${totalChunks} to the API. Duration: ${durationParam !== null ? durationParam.toFixed(2) + 's' : 'Unknown'}...`);
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`Received response for chunk ${currentChunk}. Text length: ${data.text ? data.text.length : 0}`);

            if (data.segments) {
                data.segments.forEach((segment) => {
                    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
                        // הוספת totalElapsedTime לחותמות הזמן היחסיות
                        const startTime = formatTimestamp(segment.start + globalState.totalElapsedTime);
                        const endTime = formatTimestamp(segment.end + globalState.totalElapsedTime);
                        const text = segment.text.trim();
                        transcriptionData.push({
                            text: text,
                            timestamp: `${startTime} --> ${endTime}`
                        });
                    } else {
                        console.warn(`Invalid timestamp for segment in chunk ${currentChunk}:`, segment);
                    }
                });

                // **התיקון הקריטי לסחף זמן:**
                // במקום להשתמש בזמן הסיום המדווח של ה-API, אנו משתמשים במשך הזמן האמיתי של ה-Chunk אם הוא ידוע.
                if (durationParam !== null) {
                    globalState.totalElapsedTime += durationParam;
                    console.log(`[FIXED TIME] totalElapsedTime updated by actual duration: ${durationParam.toFixed(2)}s. New total: ${globalState.totalElapsedTime.toFixed(2)}s`);
                } else {
                    // אם משך הזמן לא ידוע (כמו ב-MP3 גולמי שלא פוענח), נסמוך על ה-API כגיבוי
                    const lastSegment = data.segments[data.segments.length - 1];
                    if (lastSegment && typeof lastSegment.end === 'number') {
                         globalState.totalElapsedTime += lastSegment.end;
                         console.warn(`[API TIME] totalElapsedTime updated by API end time: ${lastSegment.end.toFixed(2)}s. This may cause drift! New total: ${globalState.totalElapsedTime.toFixed(2)}s`);
                    }
                }
            } else {
                console.warn(`Missing segments in response for chunk ${currentChunk}. This chunk's audio may be lost.`);
                // אם אין סגמנטים, עדיין חייבים לקדם את הזמן המצטבר לפי משך הזמן האמיתי
                if (durationParam !== null) {
                    globalState.totalElapsedTime += durationParam;
                    console.warn(`[GAP DETECTED] No segments, advancing totalElapsedTime by actual duration: ${durationParam.toFixed(2)}s.`);
                }
            }
        } else {
            // טיפול בשגיאות
            if (response.status === 401) {
                alert('שגיאה במפתח API. נא להזין מפתח חדש.');
                localStorage.removeItem('groqApiKey');
                location.reload();
                return;
            }
            const errorText = await response.text();
            console.error(`Error for chunk ${currentChunk}:`, errorText);
            
            // נסה לנתח את שגיאת מגבלת הקצב
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error && errorData.error.code === 'rate_limit_exceeded') {
                    let waitTime = errorData.error.message.match(/try again in ([\d\w\.]+)/)?.[1];
                    if (waitTime) {
                        waitTime = waitTime
                            .replace('s', ' שניות')
                            .replace('m', ' דקות')
                            .replace('h', ' שעות')
                            .replace('d', ' ימים');
                    }
                    alert(`מכסת התמלולים שלך לשעה הסתיימה. נא להמתין ${waitTime || 'זמן מה'} ולהתחיל מחדש את התהליך.`);
                    resetProcess();
                    return;
                }
            } catch (parseError) {
                console.warn('Failed to parse error response:', parseError);
            }
            
             // אם הייתה שגיאה כללית (כמו 400), אך לא מגבלת קצב, פשוט המשך למקטע הבא
        }
    } catch (error) {
        console.error('Network error:', error);
    }
}

// --------------------------------------------------------------------------------------
//
// פונקציות עזר ו-UI (ללא שינוי מהותי)
//
// --------------------------------------------------------------------------------------

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
    const title = `תמלול קובץ אודיו: ${audioFileName}  :בוצע באמצעות https://tamleli.netlify.app\n\n`;
    globalState.transcriptionDataText = title + data.map(d => cleanText(d.text)).join(" ").trim();
    globalState.transcriptionDataSRT = title + data.map((d, index) => {
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

    transcriptionResult.textContent = (format === "text") ? globalState.transcriptionDataText : globalState.transcriptionDataSRT;
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
        if (!globalState.transcriptionDataText) {
            alert('אין תמלול להעתקה.');
            return;
        }
        textToCopy = globalState.transcriptionDataText;
    } else if (format === "srt") {
        if (!globalState.transcriptionDataSRT) {
            alert('אין תמלול להעתקה.');
            return;
        }
        textToCopy = globalState.transcriptionDataSRT;
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

    const shortAudioFileName = globalState.audioFileName.length > 15 ? globalState.audioFileName.substring(0, 15) + "..." : globalState.audioFileName;

    if (format === "text") {
        if (!globalState.transcriptionDataText) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([globalState.transcriptionDataText], { type: 'text/plain' });
        fileName = `transcription_${shortAudioFileName}.txt`;
    } else if (format === "srt") {
        if (!globalState.transcriptionDataSRT) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([globalState.transcriptionDataSRT], { type: 'text/plain' });
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
    globalState.estimatedTime = 0;
    globalState.audioFileName = '';
    globalState.transcriptionDataText = '';
    globalState.transcriptionDataSRT = '';
    globalState.totalElapsedTime = 0;

    closeModal('modal1');
    closeModal('modal3');
    closeModal('modal4');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('startProcessBtn').style.display = 'block';
}

function calculateEstimatedTime(audioFile) {
    if (!audioFile) return;
    const sizeMB = audioFile.size / (1024 * 1024);
    // זו הערכה גסה מאוד, אך נשארת כפי שהייתה
    if (audioFile.type.includes('mp3')) {
        globalState.estimatedTime = sizeMB * 1;
    } else if (audioFile.type.includes('wav')) {
        globalState.estimatedTime = sizeMB * 0.4;
    } else {
        globalState.estimatedTime = sizeMB * 1.5;
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
    if(modal) {
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
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

// -------- פונקציות סגמנטציה לחלוקה לפי דוברים (ללא שינוי מהותי) --------

function showSpeakerSegmentationModal() {
    openModal('speakerSegmentationModal');
}

async function startSpeakerSegmentation() {
    let intervieweeName = document.getElementById('intervieweeNameInput').value.trim();
    if (!intervieweeName) {
        intervieweeName = "מרואיין";
    }

    const transcriptionText = globalState.transcriptionDataText;
    if (!transcriptionText) {
        alert("אין תמלול לעיבוד חלוקת דוברים.");
        return;
    }
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
            fullResult += result.replace(new RegExp(`(מראיין:|${intervieweeName}:)`, 'g'), "\n$1") + "\n\n";
            document.getElementById("segmentationResult").textContent = fullResult;
        } catch (error) {
            console.error("Error with segment:", error);
            document.getElementById("segmentationResult").textContent += `\n\n--- שגיאה בעיבוד מקטע זה: ${error.message} ---\n\n`;
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
    const apiKey = globalState.apiKey;

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
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000 + 1000)); // הוסף שנייה יתרה
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
    resetProcess();

    document.getElementById('downloadButton').style.display = 'none';
    document.getElementById('copyButton').style.display = 'none';

    document.getElementById("segmentationResult").textContent = "";
    document.getElementById("intervieweeNameInput").value = "";
}
