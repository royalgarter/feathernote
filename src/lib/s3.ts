'use client';

import { S3Client, PutObjectCommand, PutObjectCommandOutput, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Note } from '@/contexts/NoteContext';

interface S3Credentials {
    bucket: string;
    region?: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
}

const getS3Client = (creds: S3Credentials) => {
    return new S3Client({
        region: creds.region,
        endpoint: creds.endpoint,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
        },
        forcePathStyle: !!creds.endpoint, 
    });
};

export const uploadNoteToS3 = async (note: Note, creds: S3Credentials): Promise<PutObjectCommandOutput> => {
    const s3Client = getS3Client(creds);
    const noteJson = JSON.stringify(note, null, 2);
    const body = new TextEncoder().encode(noteJson);

    const command = new PutObjectCommand({
        Bucket: creds.bucket,
        Key: `${note.id}.json`,
        Body: body,
        ContentType: 'application/json',
    });

    try {
        const response = await s3Client.send(command);
        return response;
    } catch (error) {
        console.error(`S3 Upload Error for note ${note.id}:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to upload to S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 upload.');
    }
};

export const listNotesInS3 = async (creds: S3Credentials): Promise<string[]> => {
    const s3Client = getS3Client(creds);
    const command = new ListObjectsV2Command({
        Bucket: creds.bucket,
    });

    try {
        const response = await s3Client.send(command);
        return response.Contents?.map(item => item.Key?.replace('.json', '') || '').filter(Boolean) || [];
    } catch (error) {
        console.error("S3 List Error:", error);
        if (error instanceof Error) {
            throw new Error(`Failed to list notes in S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 list operation.');
    }
};

export const downloadNoteFromS3 = async (noteId: string, creds: S3Credentials): Promise<Note> => {
    const s3Client = getS3Client(creds);
    const command = new GetObjectCommand({
        Bucket: creds.bucket,
        Key: `${noteId}.json`,
    });

    try {
        const response = await s3Client.send(command);
        if (response.Body) {
            const str = await response.Body.transformToString();
            return JSON.parse(str) as Note;
        }
        throw new Error('Downloaded note has no body');
    } catch (error) {
        console.error(`S3 Download Error for note ${noteId}:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to download note from S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 download.');
    }
};