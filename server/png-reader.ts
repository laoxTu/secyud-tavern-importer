/**
 * SillyTavern PNG 角色卡解析
 *
 * ST 将角色卡 JSON 以 base64 编码存储在 PNG 的 tEXt 块中：
 *   V2: keyword "chara" → spec = "chara_card_v2"
 *   V3: keyword "ccv3"  → spec = "chara_card_v3"（优先读取）
 *
 * 参考: npm 包 parsecard、SillyTavern 源码
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngCharResult {
    /** 解析后的角色卡 JSON */
    json: Record<string, any>;
    /** 去除 tEXt 元数据后的纯净 PNG buffer */
    cleanPng: Buffer;
}

/**
 * 从 PNG buffer 中提取 ST 角色卡数据并返回去元数据后的图片
 * @returns null 如果不是有效的 ST PNG 角色卡
 */
export function parseStPng(buffer: Buffer): PngCharResult | null {
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

    let charaJson: Record<string, any> | null = null;
    const chunks: { type: string; data: Buffer }[] = [];
    let offset = 8;

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        const crc = buffer.readUInt32BE(offset + 8 + length);

        chunks.push({type, data});

        if (type === 'tEXt' || type === 'iTXt') {
            const nullIdx = data.indexOf(0);
            if (nullIdx > 0) {
                const keyword = data.subarray(0, nullIdx).toString('ascii');
                if (keyword === 'ccv3' || keyword === 'chara') {
                    const b64 = data.subarray(nullIdx + 1).toString('utf-8');
                    try {
                        const parsed = JSON.parse(
                            Buffer.from(b64, 'base64').toString('utf-8')
                        );
                        // ccv3 优先于 chara
                        if (!charaJson || keyword === 'ccv3') {
                            charaJson = parsed;
                        }
                    } catch { /* 解析失败则忽略 */ }
                }
            }
        }

        offset += 12 + length;
    }

    if (!charaJson) return null;

    // 构建去元数据的 PNG：跳过 chara/ccv3 的 tEXt 块
    const filteredChunks = chunks.filter(c => {
        if (c.type !== 'tEXt' && c.type !== 'iTXt') return true;
        const nullIdx = c.data.indexOf(0);
        if (nullIdx <= 0) return true;
        const keyword = c.data.subarray(0, nullIdx).toString('ascii');
        return keyword !== 'ccv3' && keyword !== 'chara';
    });

    const cleanPng = buildPng(filteredChunks);

    return {json: charaJson, cleanPng};
}

function buildPng(chunks: { type: string; data: Buffer }[]): Buffer {
    const parts: Buffer[] = [PNG_SIGNATURE];
    for (const chunk of chunks) {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.data.length, 0);
        const typeBuf = Buffer.from(chunk.type, 'ascii');
        const crcData = Buffer.concat([typeBuf, chunk.data]);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(crcData), 0);

        parts.push(lenBuf, typeBuf, chunk.data, crcBuf);
    }
    return Buffer.concat(parts);
}

// CRC32 查表实现
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
}

function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
