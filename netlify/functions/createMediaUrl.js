const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        const apiKey = event.headers['pyannote-api-key'];  // קבלת מפתח ה-API מהבקשה

        const response = await fetch('https://api.pyannote.ai/v1/media/input', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: 'media://' + apiKey.slice(-4) + '77Yflp'  // יצירת מפתח ייחודי
            })
        });

        if (response.ok) {
            const data = await response.json();
            return {
                statusCode: 200,
                body: JSON.stringify({ uploadUrl: data.url })
            };
        } else {
            const errorText = await response.text();
            throw new Error(`Error creating media URL: ${errorText}`);
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
