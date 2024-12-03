const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        // קבלת מפתח ה-API ממשתני הסביבה
        const apiKey = process.env.PYANNOTE_API_KEY;

        // יצירת כתובת זמנית להעלאת קובץ
        const response = await fetch('https://api.pyannote.ai/v1/media/input', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: `media://${generateObjectKey()}`
            })
        });

        if (!response.ok) {
            throw new Error('Failed to create media URL.');
        }

        const data = await response.json();
        return {
            statusCode: 200,
            body: JSON.stringify({ uploadUrl: data.url })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// פונקציה ליצירת מפתח ייחודי
function generateObjectKey() {
    return Math.random().toString(36).substr(2, 9) + "77Yflp";
}
