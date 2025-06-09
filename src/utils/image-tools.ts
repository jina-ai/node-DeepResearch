import canvas from '@napi-rs/canvas';
import { getEmbeddings } from '../tools/embeddings';
import { TokenTracker } from './token-tracker';
import { ImageObject } from '../types';
import { cosineSimilarity } from '../tools/cosine';
export type { Canvas, Image } from '@napi-rs/canvas';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';

export const downloadFile = async (uri: string) => {
    const resp = await fetch(uri);
    if (!(resp.ok && resp.body)) {
        throw new Error(`Unexpected response ${resp.statusText}`);
    }
    const contentLength = parseInt(resp.headers.get('content-length') || '0');
    if (contentLength > 1024 * 1024 * 100) {
        throw new Error('File too large');
    }
    const buff = await resp.arrayBuffer();

    return { buff, contentType: resp.headers.get('content-type') };
};

const _loadImage = async (input: string | Buffer) => {
  let buff;
  let contentType;

  if (typeof input === 'string') {
      if (input.startsWith('data:')) {
          const firstComma = input.indexOf(',');
          const header = input.slice(0, firstComma);
          const data = input.slice(firstComma + 1);
          const encoding = header.split(';')[1];
          contentType = header.split(';')[0].split(':')[1];
          if (encoding?.startsWith('base64')) {
              buff = Buffer.from(data, 'base64');
          } else {
              buff = Buffer.from(decodeURIComponent(data), 'utf-8');
          }
      }
      if (input.startsWith('http')) {
        if (input.endsWith('.svg')) {
          throw new Error('Unsupported image type');
        }
        const r = await downloadFile(input);
        buff = Buffer.from(r.buff);
        contentType = r.contentType;
      }
  }

  if (!buff) {
      throw new Error('Invalid input');
  }

  const img = await canvas.loadImage(buff);
  Reflect.set(img, 'contentType', contentType);

  return {
    img,
    buff,
    contentType,
  };
}

export const loadImage = async (uri: string | Buffer) => {
    try {
        const theImage = await _loadImage(uri);

        return theImage;
    } catch (err: any) {
        if (err?.message?.includes('Unsupported image type') || err?.message?.includes('unsupported')) {
            throw new Error(`Unknown image format for ${uri.slice(0, 128)}`);
        }
        throw err;
    }
}

export const fitImageToSquareBox = (image: canvas.Image | canvas.Canvas, size: number = 1024) => {
    if (image.width <= size && image.height <= size) {
      const canvasInstance = canvas.createCanvas(image.width, image.height);
      const ctx = canvasInstance.getContext('2d');
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvasInstance.width, canvasInstance.height);
      
      return canvasInstance;
    }

    const aspectRatio = image.width / image.height;

    const resizedWidth = Math.round(aspectRatio > 1 ? size : size * aspectRatio);
    const resizedHeight = Math.round(aspectRatio > 1 ? size / aspectRatio : size);

    const canvasInstance = canvas.createCanvas(resizedWidth, resizedHeight);
    const ctx = canvasInstance.getContext('2d');
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, resizedWidth, resizedHeight);

    return canvasInstance;
}


export const canvasToDataUrl = (canvas: canvas.Canvas, mimeType?: 'image/png' | 'image/jpeg') => {
    return canvas.toDataURLAsync((mimeType || 'image/png') as 'image/png');
}

export const canvasToBuffer = (canvas: canvas.Canvas, mimeType?: 'image/png' | 'image/jpeg') => {
    return canvas.toBuffer((mimeType || 'image/png') as 'image/png');
}

export const processImage = async (url: string, tracker: TokenTracker): Promise<ImageObject | undefined> => {
  try {
    const { img, buff, contentType } = await loadImage(url);
    if (!img) {
      return;
    }

    // Check if the image is smaller than 256x256
    if (img.width < 256 || img.height < 256) {
      return;
    }

    const newUrl = await saveImageToFirebase(buff, contentType);
    const canvas = fitImageToSquareBox(img, 512);
    const base64Data = (await canvasToDataUrl(canvas)).split(',')[1];

    const {embeddings} = await getEmbeddings([{ image: base64Data }], tracker, {
      dimensions: 1024,
      model: 'jina-clip-v2',
    });

    return {
      url: newUrl ?? url,
      embedding: embeddings,
    };

  } catch (error) {
    return;
  }
}

export const dedupImagesWithEmbeddings = (
  newImages: ImageObject[], // New images with embeddings
  existingImages: ImageObject[], // Existing images with embeddings
  similarityThreshold: number = 0.86, // Default similarity threshold
): ImageObject[]  =>{
  try {
    // Quick return for single new image with no existing images
    if (newImages.length === 1 && existingImages.length === 0) {
      return newImages;
    }

    const uniqueImages: ImageObject[] = [];
    const usedIndices = new Set<number>();

    // Compare each new image against existing images and already accepted images
    for (let i = 0; i < newImages.length; i++) {
      let isUnique = true;

      // Check against existing images
      for (let j = 0; j < existingImages.length; j++) {
        const similarity = cosineSimilarity(
          newImages[i].embedding[0], // Use the first embedding for comparison
          existingImages[j].embedding[0]
        );
        if (similarity >= similarityThreshold) {
          isUnique = false;
          break;
        }
      }

      // Check against already accepted images
      if (isUnique) {
        for (const usedIndex of usedIndices) {
          const similarity = cosineSimilarity(
            newImages[i].embedding[0], // Use the first embedding for comparison
            newImages[usedIndex].embedding[0]
          );
          if (similarity >= similarityThreshold) {
            isUnique = false;
            break;
          }
        }
      }

      // Add to unique images if passed all checks
      if (isUnique) {
        uniqueImages.push(newImages[i]);
        usedIndices.add(i);
      }
    }

    return uniqueImages;
  } catch (error) {
    console.error('Error in image deduplication analysis:', error);

    // Return all new images if there is an error
    return newImages;
  }
}

export const saveImageToFirebase = async (
  buffer: Buffer,
  mimeType?: string | null,
): Promise<string | undefined> => {
  if (!process.env.GCLOUD_PROJECT) {
    console.error('GCLOUD_PROJECT environment variable is not set');
    return;
  }
  const firebaseDefaultBucket = new Storage().bucket(`${process.env.GCLOUD_PROJECT}.appspot.com`);

  try {
    let extension = 'png';
    const finalMimeType = mimeType || 'image/png';

    if (!finalMimeType.startsWith('image/')) {
      return;
    } else {
      extension = finalMimeType?.split('/')[1] || 'png';
    }

    const fileName = `readImages/${randomUUID()}.${extension}`;
    
    const file = firebaseDefaultBucket.file(fileName);
    
    await file.save(buffer, {
      contentType: finalMimeType,
      public: true,
    });
    
    return file.publicUrl();
  } catch (error) {
    console.error('Error saving image to Firebase Storage:', error);
    return;
  }
};