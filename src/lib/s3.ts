'use client';

import { S3Client, PutObjectCommand, PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { Note } from '@/contexts/NoteContext';

interface S3Credentials {
    bucket: string;
    region?: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export const syncNotesToS3 = async (notes: Note[], creds: S3Credentials): Promise<PutObjectCommandOutput> => {
    
    const s3Client = new S3Client({
        region: creds.region,
        endpoint: creds.endpoint,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
        },
        // forcePathStyle is often required for S3-compatible services
        forcePathStyle: !!creds.endpoint, 
    });

    const notesJson = JSON.stringify(notes, null, 2);
    const notesBlob = new Blob([notesJson], { type: 'application/json' });

    const command = new PutObjectCommand({
        Bucket: creds.bucket,
        Key: 'notes.json',
        Body: notesBlob,
        ContentType: 'application/json',
    });

    try {
        const response = await s3Client.send(command);
        return response;
    } catch (error) {
        console.error("S3 Upload Error:", error);
        if (error instanceof Error) {
            // Re-throw a more specific error to be caught in the UI
             throw new Error(`Failed to upload to S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 upload.');
    }
};
