import canvas from '@napi-rs/canvas';
import { ImageObject } from '../types';
import { TokenTracker } from './token-tracker';
import { rerankImages } from '../tools/jina-rerank';
export type { Canvas, Image } from '@napi-rs/canvas';

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

  return img;
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
    if (image.width < size ||image.height < size) return;

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

export const processImage = async (url: string): Promise<ImageObject | undefined> => {
  try {
    const img = await loadImage(url);
    if (!img) {
      console.error('Failed to load image:', url);
      return;
    }

    const canvas = fitImageToSquareBox(img, 256);
    if (!canvas) {
      console.error('Image size is too small:', url);
      return;
    }

    const base64Url = await canvasToDataUrl(canvas);
    const imageObj = { 
      url, 
      data: base64Url, 
      width: img.naturalWidth, 
      height: img.naturalHeight,
    };

    return imageObj;
  } catch (error) {
    console.error(`Error processing image: ${url}`, error);
  }
}


interface RankResult {
  index: number;
  relevance_score: number;
}

export const rankImages = async (
  images: ImageObject[],
  query: string,
  tracker: TokenTracker,
  answer?: string
): Promise<ImageObject[]> => {
  if (images.length === 0) return [];

  const originalImageBytes = images.map((i) => ({
    bytes: i.data.split(',')[1],
  }));

  const answerParagraphs = answer
    ?.split('\n\n\n\n')[0]
    .split('\n\n')
    .filter((i) => i.trim().length > 30 && !i.trim().startsWith('```')) || [];

  try {
    const firstRoundRankResults: RankResult[] = (
      await rerankImages(query, originalImageBytes, tracker, 20)
    ).results;

    console.log('First Round Results:', JSON.stringify(firstRoundRankResults));

    if (firstRoundRankResults.length === 0) return [];

    const relevantFirstRoundResults = firstRoundRankResults.filter(
      (r) => r.relevance_score > 0.1
    );

    if (answerParagraphs.length === 0) {
      return relevantFirstRoundResults.map((r) => images[r.index]).slice(0, 5);
    }

    const intermediateRankedImages = relevantFirstRoundResults.map((r) => ({
      bytes: originalImageBytes[r.index].bytes,
      originalIndex: r.index,
    }));

    const secondRoundRankResults: RankResult[][] = await Promise.all(
      answerParagraphs.map(async (content) =>
        (await rerankImages(content, intermediateRankedImages.map((i) => ({ bytes: i.bytes })), tracker, 3)).results
      )
    );

    const finalRankedResults: RankResult[] = secondRoundRankResults
      .flat()
      .filter((r) => r.relevance_score > 0.5)
      .sort((a, b) => b.relevance_score - a.relevance_score);

    console.log('Final Ranked Results:', JSON.stringify(finalRankedResults));

    const result: ImageObject[] = [];

    finalRankedResults.forEach((img) => {
      const originalImageIndex = intermediateRankedImages[img.index].originalIndex;
      const item = images[originalImageIndex];
      if (!result.includes(item)) {
        result.push(item);
      }
    });

    console.log('Final Results:', result.length, JSON.stringify(result.map((i) => i.url)));
    return result;
  } catch (error) {
    console.error('Error in getRankedImages:', error);
    return [];
  }
}

export const rankImages2 = async (
  images: ImageObject[],
  query: string,
  tracker: TokenTracker,
  answer?: string
): Promise<ImageObject[]> => {
  const topN = 20; // Adjust as needed
  const weightQuery = 0.4; // Adjust weights
  const weightParagraph = 0.6;

  try {
    const originalImageBytes = images.map((i) => ({
      bytes: i.data.split(',')[1],
    }));

    const answerParagraphs = answer
      ?.split('\n\n\n\n')[0]
      .split('\n\n')
      .filter((i) => i.trim().length > 30 && !i.trim().startsWith('```')) || [];

    const firstRoundResults = (await rerankImages(query, originalImageBytes, tracker, topN)).results;

    if (firstRoundResults.length === 0) return []; 

    const selectedImages = firstRoundResults.map((r) => ({
      bytes: originalImageBytes[r.index].bytes,
      originalIndex: r.index,
      queryScore: r.relevance_score,
    }));

    const paragraphScores: number[][] = await Promise.all(
      answerParagraphs.map(async (paragraph) =>
        (await rerankImages(paragraph, selectedImages.map((i) => ({ bytes: i.bytes })), tracker, topN)).results.sort((a,b) => a.index - b.index).map((r) => r.relevance_score)
      )
    );

    const imageScores: { index: number; finalScore: number }[] = selectedImages.map((selectedImage, selectedImageIndex) => {
      let paragraphScore = 0;
      if(paragraphScores.length > 0) {
        paragraphScore = paragraphScores.reduce((sum, scores) => sum + scores[selectedImageIndex], 0) / paragraphScores.length;
      }

      const finalScore = selectedImage.queryScore * weightQuery + paragraphScore * weightParagraph;

      return { index: selectedImage.originalIndex, finalScore };
    });

    const rankedImages = imageScores.filter((i) => i.finalScore > 0.5).sort((a, b) => b.finalScore - a.finalScore)

    console.log('Ranked Images:', JSON.stringify(rankedImages), JSON.stringify(imageScores));
    return rankedImages.slice(0, 5).map((rankedImage) => images[rankedImage.index]);
  } catch (error) {
    console.error('Error in rankImages:', error);
    return [];
  }
}