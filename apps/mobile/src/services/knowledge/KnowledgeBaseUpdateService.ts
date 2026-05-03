import {
  documentDirectory,
  writeAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import { networkStore } from '../../store/networkStore';
import { getMetadata, setMetadata } from '../../db/queries';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const LOCAL_VERSION_KEY = 'kb_local_version';

export async function checkAndUpdateKnowledgeBase(): Promise<void> {
  try {
    const mode = networkStore.getState().mode;
    if (mode === 'OFFLINE') return;

    const response = await fetch(`${API_BASE_URL}/api/v1/knowledge/version`);
    if (!response.ok) return;

    const { version: serverVersion } = await response.json() as { version: number };

    const localVersionStr = await getMetadata(LOCAL_VERSION_KEY);
    const localVersion = localVersionStr ? parseInt(localVersionStr, 10) : 0;

    if (serverVersion <= localVersion) return;

    const indexResponse = await fetch(`${API_BASE_URL}/api/v1/knowledge/index`);
    if (!indexResponse.ok) return;

    const indexBuffer = await indexResponse.arrayBuffer();
    const base64 = Buffer.from(indexBuffer).toString('base64');

    const indexPath = `${documentDirectory}knowledge_index.faiss`;
    await writeAsStringAsync(indexPath, base64, {
      encoding: EncodingType.Base64,
    });

    await setMetadata(LOCAL_VERSION_KEY, serverVersion.toString());
    console.log(`[KnowledgeBase] Updated: v${localVersion} → v${serverVersion}`);
  } catch (err) {
    console.warn('[KnowledgeBase] Silent update failure:', err);
  }
}
