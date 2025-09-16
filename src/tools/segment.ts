interface ChunkOptions {
    type?: 'newline' | 'punctuation' | 'characters' | 'regex';
    value?: string | number;
    minChunkLength?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): {
    chunks: string[];
    chunk_positions: [number, number][];
} {
    let chunks: string[] = [];
    const minChunkLength = options.minChunkLength || 80;
    const type = options.type || 'newline';

    switch (type) {
        case 'newline':
            chunks = text.split('\n').filter(chunk => chunk.trim().length > 0);
            break;

        case 'punctuation':
            // Split by common Chinese and English punctuation while preserving them
            chunks = text.split(/(?<=[.!?。！？])/).filter(chunk => chunk.trim().length > 0);
            break;

        case 'characters': {
            const chunkSize = Number(options.value) || 1000;
            for (let i = 0; i < text.length; i += chunkSize) {
                chunks.push(text.slice(i, i + chunkSize));
            }
            break;
        }

        case 'regex': {
            if (!options.value || typeof options.value !== 'string') {
                throw new Error('Regex pattern is required for regex chunking');
            }
            chunks = text.split(new RegExp(options.value)).filter(chunk => chunk.trim().length > 0);
            break;
        }

        default:
            throw new Error('Invalid chunking type');
    }

    // Filter out chunks that are too short
    const filteredChunks: string[] = [];
    const filteredPositions: [number, number][] = [];
    let currentPos = 0;

    for (const chunk of chunks) {
        const startPos = text.indexOf(chunk, currentPos);
        if (startPos === -1) continue; // Skip if chunk not found
        const endPos = startPos + chunk.length;

        // Only include chunks that meet the minimum length requirement
        if (chunk.length >= minChunkLength) {
            filteredChunks.push(chunk);
            filteredPositions.push([startPos, endPos]);
        }
        currentPos = endPos;
    }

    return {
        chunks: filteredChunks,
        chunk_positions: filteredPositions
    };
} 