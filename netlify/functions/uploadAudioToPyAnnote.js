const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        const { uploadUrl, audioFileBase64 } = JSON.parse(event.body);
        const audioFile = Buffer.from(audioFileBase64, 'base64');

        const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'audio/wav'
            },
            body: audioFile
        });

        if (!response.ok) {
            throw new Error('Failed to upload media file.');
        }

        return {
            statusCode: 200,
            body: 'File uploaded successfully'
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
