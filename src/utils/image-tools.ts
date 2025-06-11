import { getEmbeddings } from '../tools/embeddings';
import { TokenTracker } from './token-tracker';
import { ImageObject } from '../types';
import { cosineSimilarity } from '../tools/cosine';
import { logInfo, logError, logDebug, logWarning } from '../logging';
import sharp from 'sharp';

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
  const contentType = resp.headers.get('content-type');
  if (!contentType || !contentType.startsWith('image/')) {
    throw new Error(`Invalid content type ${contentType}, expected image/*`);
  }

  return { buff, contentType };
};

const loadImage = async (input: string | Buffer) => {
  let buff;
  let contentType: string = '';

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

  if (buff.length > 20 * 1024 * 1024) {
    throw new Error('Image too large');
  }

  return {
    buff,
    contentType,
  };
}

const ImageTypes = ['png', 'jpeg', 'jpg', 'webp', 'avif', 'tiff', 'gif', 'svg', 'bmp', 'heif', 'jxl', 'jp2', 'ppm', 'raw', 'exr', 'fits', 'rad'];

export const fitImageToSquareBox = async (imageBuffer: Buffer, contentType: string, size: number = 1024) => {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('Invalid image buffer');
  }

  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
    throw new Error('Image must be at least 256x256 pixels');
  }

  let width = metadata.width;
  let height = metadata.height;
  const targetSize = size;
  const imageType = contentType.split('/')[1];
  if (!ImageTypes.includes(imageType)) {
    throw new Error(`Unsupported image type: ${imageType}`);
  }
  
  if (width > targetSize || height > targetSize) {
    const aspectRatio = width / height;
    
    if (aspectRatio > 1) {
      width = targetSize;
      height = Math.round(targetSize / aspectRatio);
    } else {
      height = targetSize;
      width = Math.round(targetSize * aspectRatio);
    }
  }
  
  const resizedImageBuffer = await sharp(imageBuffer)
    .resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .toFormat(imageType as any)
    .toBuffer();

  return resizedImageBuffer.toString('base64');
}

export const processImage = async (url: string, tracker: TokenTracker): Promise<ImageObject | undefined> => {
  try {
    const { buff, contentType } = await loadImage(url);
    const base64Data = await fitImageToSquareBox(buff, contentType, 256);


    const { embeddings } = await getEmbeddings([{ image: base64Data }], tracker, {
      dimensions: 512,
      model: 'jina-clip-v2',
    });

    return {
      url,
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
): ImageObject[] => {
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
    logError('Error in image deduplication analysis:', { error });

    // Return all new images if there is an error
    return newImages;
  }
}