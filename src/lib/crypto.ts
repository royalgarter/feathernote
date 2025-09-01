
'use client';

// Helper function to convert buffer to base64
function bufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Helper function to convert base64 to buffer
function base64ToBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// Derives a key from a user ID using PBKDF2. This is more secure than using the ID directly.
async function getKey(userId: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(userId),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

// Encrypts a JSON-stringifiable object.
export async function encryptSettings(settings: object, userId: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await getKey(userId, salt);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedSettings = enc.encode(JSON.stringify(settings));

    const encryptedContent = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        encodedSettings
    );

    const encryptedPackage = {
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        content: bufferToBase64(encryptedContent)
    };
    
    return JSON.stringify(encryptedPackage);
}

// Decrypts the string back into an object.
export async function decryptSettings<T>(encryptedString: string, userId: string): Promise<T | null> {
    try {
        const { salt: saltB64, iv: ivB64, content: contentB64 } = JSON.parse(encryptedString);

        const salt = base64ToBuffer(saltB64);
        const iv = base64ToBuffer(ivB64);
        const content = base64ToBuffer(contentB64);
        
        const key = await getKey(userId, salt);

        const decryptedContent = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            key,
            content
        );

        const dec = new TextDecoder();
        return JSON.parse(dec.decode(decryptedContent)) as T;
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}
