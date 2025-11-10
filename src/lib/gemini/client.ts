import { type ReservationSlotId } from '@/lib/firebase';

export type GeminiSlotNames = Record<ReservationSlotId, string[]>;

export type GeminiReservationAnalysis = {
  date: string;
  gymName?: string | null;
  slots: GeminiSlotNames;
};

export type GeminiReservationAnalysisResult = GeminiReservationAnalysis[];

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const buildAnalysisPrompt = (participants: string[]): string => {
  const participantName = participants[0] ?? '';

  return `
あなたは体育館の予約画面スクリーンショットを解析し、Firestore に保存するためのデータを抽出します。次の要件に従って出力してください。

1. 予約日（西暦 YYYY-MM-DD）
2. 施設名 (体育館名のみで良い。「体育室, 競技室」などは不要。)
3. 各時間枠（morning / afternoon / night）の予約者名リスト
   - 時間枠は必ず "morning" (午前), "afternoon" (午後), "night" (夜) の3種類のキーを用いる
   - 画像に該当枠の情報が無い場合はslotsの中のkeyごと必要ありません。
   - 各枠には同じ予約者名を使用する

出力は必ず下記の JSON 形式（余計な空白や説明文を含めない）で返してください。
  - 複数のデータがある場合は日付の若い順でソートしてください。
  - 予約者名は ${participantName} であることを確認してください。
  - 必ずslotsの子のvalueの中に ${participantName} が1つだけ含まれていることを確認してください。
{
  "date": "YYYY-MM-DD",
  "gymName": "施設名（不明なら \"\" または null）",
  "slots": {
    "morning": [],
    "afternoon": [],
    "night": []
  }
}
`.trim();
};

type GeminiContentPart =
  | { text: string }
  | {
      inline_data: {
        mime_type: string;
        data: string;
      };
    };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const extractResponseText = (response: GeminiResponse): string | null => {
  const candidate = response.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.length) {
    return null;
  }

  const part = candidate.content.parts.find((item) => item.text);
  return part?.text ?? null;
};

const normalizeSlotNames = (slots: Partial<Record<string, string[]>>): GeminiSlotNames => ({
  morning: Array.isArray(slots.morning) ? slots.morning : [],
  afternoon: Array.isArray(slots.afternoon) ? slots.afternoon : [],
  night: Array.isArray(slots.night) ? slots.night : [],
});

const normalizeAnalysis = (value: unknown): GeminiReservationAnalysisResult => {
  const toAnalysis = (item: unknown): GeminiReservationAnalysis | null => {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const candidate = item as Partial<GeminiReservationAnalysis>;
    if (!candidate.date || typeof candidate.date !== 'string') {
      return null;
    }

    return {
      date: candidate.date,
      gymName:
        typeof candidate.gymName === 'string' && candidate.gymName.length > 0
          ? candidate.gymName
          : null,
      slots: normalizeSlotNames(
        candidate.slots && typeof candidate.slots === 'object'
          ? (candidate.slots as Partial<Record<string, string[]>>)
          : {},
      ),
    };
  };

  if (Array.isArray(value)) {
    return value
      .map((item) => toAnalysis(item))
      .filter((item): item is GeminiReservationAnalysis => item !== null);
  }

  if (value && typeof value === 'object' && 'reservations' in value) {
    const reservations = (value as { reservations?: unknown }).reservations;
    if (Array.isArray(reservations)) {
      return normalizeAnalysis(reservations);
    }
  }

  const single = toAnalysis(value);
  return single ? [single] : [];
};

export type AnalyzeReservationImageParams = {
  base64Data: string;
  mimeType: string;
  participants: string[];
};

export const analyzeReservationImage = async ({
  base64Data,
  mimeType,
  participants,
}: AnalyzeReservationImageParams): Promise<GeminiReservationAnalysisResult> => {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Gemini API キーが設定されていません。NEXT_PUBLIC_GEMINI_API_KEY を .env.local に追加してください。',
    );
  }

  const parts: GeminiContentPart[] = [
    { text: buildAnalysisPrompt(participants) },
    {
      inline_data: {
        mime_type: mimeType,
        data: base64Data,
      },
    },
  ];

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API エラー: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = extractResponseText(payload);

  if (!text) {
    throw new Error('Gemini から解析結果を取得できませんでした。');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini 応答の JSON 解析に失敗しました: ${(error as Error).message}`);
  }

  const normalized = normalizeAnalysis(parsed);

  if (normalized.length === 0) {
    throw new Error('予約情報を解析できませんでした。画像を確認してください。');
  }

  const invalidDates = normalized.filter(
    (item) => !item.date || item.date.trim().length === 0 || item.date === 'unknown',
  );

  if (invalidDates.length > 0) {
    throw new Error('一部の予約日を特定できませんでした。画像を確認してください。');
  }

  return normalized;
};

