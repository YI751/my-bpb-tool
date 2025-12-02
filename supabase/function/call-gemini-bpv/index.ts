// Supabase Edge Function: call-gemini-bpv
// ブランド・ピラミッド・ビルダー用
// 1ファイル完結型（cors.ts不要）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORSヘッダーをこのファイル内で定義（外部依存を排除）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log('[Function Start] "call-gemini-bpv" function invoked.');

Deno.serve(async (req) => {
  // CORSプリフライトリクエストの処理
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. 認証チェック
    console.log('[Auth Verify] Verifying user authentication token.');
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header.');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('[Auth Verify] Failed:', userError?.message || 'No user found.');
      return new Response(
        JSON.stringify({ error: 'Authentication failed.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log(`[Auth Verify] Success. User ID: ${user.id}`);

    // 2. Gemini APIキーの取得
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set in Supabase secrets.');
    }

    // 3. クライアントからのデータ取得
    // index.htmlからは { prompt: "...", jsonSchema: {...} } が送られてきます
    const { prompt, jsonSchema } = await req.json();

    if (!prompt) {
        throw new Error('Prompt is missing in the request body.');
    }

    // 4. Gemini APIリクエストの構築
    // STC同様、v1betaのエンドポイントを使用します（JSON Schema対応のため）
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiApiKey}`;

    // BEP用のシステムプロンプト設定
    const systemInstruction = {
        parts: [{ text: "あなたは、日本のマーケティング戦略の第一人者です。ユーザーから提供された情報はクライアントからの絶対的な要件です。これらを無視したり、矛盾する内容を生成することは許されません。入力された情報（特に課題、ペイン、特徴）を論理的に組み合わせ、整合性の取れたブランドエクイティピラミッドを構築してください。" }]
    };

    const requestPayload: any = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: systemInstruction,
      generationConfig: {
          // JSONモードを強制する設定ではありませんが、スキーマがある場合は従わせます
          responseMimeType: "application/json"
      }
    };

    // jsonSchemaがある場合は設定に追加
    if (jsonSchema) {
        requestPayload.generationConfig.responseSchema = jsonSchema;
    }

    console.log('[Gemini Request] Sending request to Gemini API (v1beta).');
    
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error(`[Gemini Request] Failed with status ${geminiResponse.status}:`, errorBody);
      throw new Error(`Gemini API error: ${errorBody}`);
    }

    const responseData = await geminiResponse.json();
    console.log('[Gemini Request] Successfully received response from Gemini API.');

    // 5. レスポンス返却
    return new Response(
      JSON.stringify(responseData),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Error] An unexpected error occurred:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});