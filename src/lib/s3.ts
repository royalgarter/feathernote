'use client';

import { S3Client, PutObjectCommand, PutObjectCommandOutput, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Note } from '@/contexts/NoteContext';

interface S3Credentials {
    bucket: string;
    region?: string;
    endpoint?: string;
    subfolder?: string;
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

const getKey = (noteId: string, creds: S3Credentials): string => {
    const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
    return `${path}${noteId}.json`;
}


export const uploadNoteToS3 = async (note: Note, creds: S3Credentials): Promise<PutObjectCommandOutput> => {
    const s3Client = getS3Client(creds);
    const noteJson = JSON.stringify(note, null, 2);
    const body = new Blob([noteJson], { type: 'application/json' });
    const key = getKey(note.id, creds);
    
    const command = new PutObjectCommand({
        Bucket: creds.bucket,
        Key: key,
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
    const prefix = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
    const command = new ListObjectsV2Command({
        Bucket: creds.bucket,
        Prefix: prefix
    });

    try {
        const response = await s3Client.send(command);
        return response.Contents?.map(item => item.Key?.replace(prefix, '').replace('.json', '') || '').filter(Boolean) || [];
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
    const key = getKey(noteId, creds);
    const command = new GetObjectCommand({
        Bucket: creds.bucket,
        Key: key,
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
