const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

const OPENAI_API_ENDPOINT = "https://openai-api-proxy-746164391621.us-west1.run.app";

// 予備シナリオ
const FALLBACK_SCENARIOS = {
    1: {
        title: "豪商の屋敷・毒殺事件",
        summary: "豪商が書斎でワインを飲んだ直後に死亡した。",
        details: "死因: 青酸カリによる毒殺",
        explanation: "犯人はA。AはBに罪を着せようとして、Bの部屋から手袋を盗んで現場に置いた（ミスリード）。しかし、毒物の小瓶を処分しきれずポケットに入れていたのが決定打となった。",
        evidence_data: [
            { name: "ワイングラス", desc: "被害者が使用。口紅付着。", inspection: "口紅は被害者の愛人のものと同じ色だ。毒はここからは検出されなかった。", isKey: false },
            { name: "空の小瓶", desc: "ゴミ箱の底にあった。", inspection: "【重要】指紋が拭き取られた形跡があるが、微量な毒物が残っている。形状からして、最近購入されたものだ。", isKey: true },
            { name: "手袋", desc: "裏口に落ちていた。", inspection: "Bのイニシャルが入っている。しかし、手袋の内側からはなぜかAの香水の匂いがする。", isKey: true },
            { name: "ハンカチ", desc: "高級な絹のハンカチ。", inspection: "被害者の胸ポケットに入っていたもの。特に不審な点はない。", isKey: false }
        ],
        suspects: [
            { char: "A", statement: "執事です。Bがキッチンのゴミ箱を漁っているのを見ましたよ。" },
            { char: "B", statement: "メイドです。Cさんが裏口で何か燃やしているのを見ました。" },
            { char: "C", statement: "弟です。Dのやつ、遺産目当てで兄貴に詰め寄ってたぜ。" },
            { char: "D", statement: "弁護士です。Aさんが落ち着かない様子で廊下を歩いていました。" }
        ]
    }
};

let gameState = {
    gameCount: 1,
    phase: 'WAITING_START', 
    liarIndex: -1,
    personas: [],
    evidenceData: [],
    theme: "",
    summary: "",
    details: "",
    explanation: "", 
    pointerX: 0
};

// モデルは gpt-4o-mini に固定
async function callAI(messages, jsonMode = false) {
    if (!process.env.OPENAI_API_KEY) {
        console.log("No API Key found. Using fallback.");
        return null;
    }
    try {
        const body = {
            model: "gpt-4o-mini", 
            messages: messages
        };
        if (jsonMode) body.response_format = { type: "json_object" };

        const response = await fetch(OPENAI_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("AI Request Failed:", error.message);
        return null;
    }
}

async function prepareGameData() {
    console.log(`Preparing Game #${gameState.gameCount}...`);
    gameState.liarIndex = Math.floor(Math.random() * 4);
    const chars = ['A', 'B', 'C', 'D'];
    const culpritChar = chars[gameState.liarIndex];

    // プロンプト修正：難易度向上、ミスリード重視
    const prompt = `
        あなたはミステリー作家です。本格的な殺人事件のシナリオをJSONで出力してください。

        【条件】
        1. **事件**: 殺人事件。死因を明確に。
        2. **犯人**: ${culpritChar}。探偵（プレイヤー）は無実。
        
        3. **重要：証拠品とミスリード（最優先事項）**:
           - **「持ち主＝犯人」という単純な構造は禁止**です。
           - 犯人は、無実の人物の持ち物を盗んで現場に置く「工作」を行っています。
           - または、無実の人物が偶然落とした物を、犯人が利用しています。
           - 証拠品4つのうち、犯人に直接結びつく決定的なものは1つだけにしてください。他はミスリードや状況証拠に留めてください。

        4. **証拠品データ (evidence_data)**:
           - **inspection**: 「詳しく調べた結果」を記述。ここで初めて「指紋が拭き取られている」「微量な血液反応」「持ち主とは違う香水の匂い」などの真実が判明します。
           - **isKey**: その調査結果が、真相（犯人の嘘や工作）を暴く鍵になるなら true。

        出力形式（JSONのみ）:
        {
            "title": "事件タイトル",
            "summary": "導入",
            "details": "死因など",
            "explanation": "解決編の解説（誰の持ち物がどう使われたか、ミスリードの真相など）",
            "evidence_data": [
                { "name": "品名", "desc": "見た目の説明", "inspection": "詳細な鑑識結果", "isKey": true/false },
                { "name": "品名", "desc": "見た目の説明", "inspection": "詳細な鑑識結果", "isKey": true/false },
                { "name": "品名", "desc": "見た目の説明", "inspection": "詳細な鑑識結果", "isKey": true/false },
                { "name": "品名", "desc": "見た目の説明", "inspection": "詳細な鑑識結果", "isKey": true/false }
            ],
            "suspects": [
                { "char": "A", "statement": "初期証言" },
                { "char": "B", "statement": "初期証言" },
                { "char": "C", "statement": "初期証言" },
                { "char": "D", "statement": "初期証言" }
            ]
        }
    `;

    let puzzle = null;
    const jsonStr = await callAI([{ role: 'system', content: prompt }], true);
    
    if (jsonStr) {
        try { puzzle = JSON.parse(jsonStr); } catch (e) { console.error("JSON Error"); }
    }
    if (!puzzle) puzzle = FALLBACK_SCENARIOS[1];

    gameState.personas = puzzle.suspects;
    gameState.theme = puzzle.title;
    gameState.summary = puzzle.summary;
    gameState.details = puzzle.details;
    gameState.explanation = puzzle.explanation;
    // 調査済みフラグを初期化
    gameState.evidenceData = puzzle.evidence_data.map(e => ({...e, inspected: false}));
    
    return true;
}

io.on('connection', (socket) => {
    socket.on('join', (room) => {
        socket.join(room);
        socket.emit('phase_change', gameState.phase);
        if (gameState.phase === 'ASKING') sendGameData(socket);
    });

    socket.on('shake_action', async () => {
        if (gameState.phase === 'WAITING_START') {
            gameState.phase = 'PREPARING';
            io.emit('phase_change', 'PREPARING'); 
            await prepareGameData();
            gameState.phase = 'TUTORIAL';
            io.emit('phase_change', 'TUTORIAL');

            setTimeout(() => {
                if (gameState.phase === 'TUTORIAL') {
                    gameState.phase = 'ASKING';
                    io.emit('phase_change', 'ASKING');
                    sendGameData(io);
                }
            }, 6000);
        } 
    });

    socket.on('sensor', (data) => {
        let val = Math.max(-30, Math.min(30, data.g));
        gameState.pointerX = val / 30; 
        io.to('game').emit('pointer_update', { x: gameState.pointerX });
    });

    // 証拠品調査イベント
    socket.on('inspect_evidence', (index) => {
        if (gameState.phase !== 'ASKING') return;
        const evidence = gameState.evidenceData[index];
        if (!evidence) return;

        let responseText = "";
        let isImportant = false;

        if (!evidence.inspected) {
            evidence.inspected = true;
            responseText = `【詳細解析結果】\n${evidence.inspection}`;
            isImportant = evidence.isKey;
        } else {
            responseText = "これ以上の情報は検出されませんでした。（調査済み）";
            isImportant = false;
        }

        io.emit('question_result', { 
            target: "鑑識", 
            q: `証拠品「${evidence.name}」を解析`, 
            a: responseText, 
            isKey: isImportant 
        });
    });

    socket.on('ask_question', async (data) => {
        if (gameState.phase !== 'ASKING') return;

        const { text, type } = data;
        const culpritName = ['A', 'B', 'C', 'D'][gameState.liarIndex];
        const secretInfo = JSON.stringify(gameState.evidenceData);

        const guardRail = `
            【禁止】メタ発言、被害者なりすまし。
            【演技】
            - 犯人は嘘をつきますが、決定的な証拠を突きつけられると動揺します。
            - 無実の人同士も疑い合ってください（ヘイト分散）。
        `;

        if (type === 'all') {
            io.emit('question_processing', { text, target: "全員" });
            const systemPrompt = `
                ${guardRail}
                あなたはA,B,C,D全員です。
                事件: ${gameState.theme} 真犯人: ${culpritName} 質問: "${text}"
                【証拠データ】${secretInfo}
                全員短く回答せよ。
                JSON: { "responses": [ {"char": "A", "answer": "...", "isKey": false}, ... ] }
            `;
            let responses = [];
            const jsonStr = await callAI([{ role: 'user', content: systemPrompt }], true);
            if(jsonStr) { try { responses = JSON.parse(jsonStr).responses; } catch(e) {} }
            if (!responses || responses.length === 0) ['A','B','C','D'].forEach(c => responses.push({char:c, answer:"...", isKey:false}));

            responses.forEach(res => io.emit('question_result', { q: text, target: res.char, a: res.answer, isKey: res.isKey }));

        } else {
            let targetIndex = -1;
            const x = gameState.pointerX;
            if (x < -0.5) targetIndex = 0; else if (x < 0) targetIndex = 1; else if (x < 0.5) targetIndex = 2; else targetIndex = 3;
            const targetChar = ['A', 'B', 'C', 'D'][targetIndex];

            io.emit('question_processing', { text, target: targetChar });
            const systemPrompt = `
                ${guardRail}
                あなたは${targetChar}です。
                事件: ${gameState.theme} 真犯人: ${culpritName} 質問: "${text}"
                【証拠データ】${secretInfo}
                JSON: { "answer": "回答", "isKey": true/false }
            `;
            let result = { answer: "...", isKey: false };
            const jsonStr = await callAI([{ role: 'user', content: systemPrompt }], true);
            if (jsonStr) { try { result = JSON.parse(jsonStr); } catch(e) { result.answer = jsonStr; } }

            io.emit('question_result', { q: text, target: targetChar, a: result.answer, isKey: result.isKey });
        }
    });

    socket.on('change_phase', (newPhase) => {
        gameState.phase = newPhase;
        io.emit('phase_change', newPhase);
    });

    socket.on('reset_game', () => {
        gameState.gameCount++;
        gameState.phase = 'WAITING_START';
        io.emit('reset');
    });

    socket.on('execute_vote', (data) => {
        if (gameState.phase !== 'VOTING') return;
        
        const x = gameState.pointerX;
        let selectedIndex = 3;
        if (x < -0.5) selectedIndex = 0; else if (x < 0) selectedIndex = 1; else if (x < 0.5) selectedIndex = 2;

        let isCorrect = (selectedIndex === gameState.liarIndex);
        let selectedChar = ['A', 'B', 'C', 'D'][selectedIndex];

        gameState.phase = 'RESULT';
        io.emit('game_over', { 
            result: isCorrect ? 'WIN' : 'LOSE', 
            selected: selectedChar,
            liar: ['A', 'B', 'C', 'D'][gameState.liarIndex],
            explanation: gameState.explanation
        });
    });

    function sendGameData(target) {
        const evNames = gameState.evidenceData.map(e => e.name);
        const displayEvidences = gameState.evidenceData.map(e => `${e.name} (${e.desc})`);
        
        target.emit('game_data', { 
            theme: gameState.theme, 
            summary: gameState.summary,
            details: gameState.details,
            evidences: displayEvidences,
            statements: gameState.personas,
            evidenceNames: evNames
        });
    }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));