const GameState = {
    deck: null,
    teams: ["Team 1", "Team 2"],
    wordCount: 10,
    currentRoundId: null,
    currentQuestionIndex: 0,
    revealedTiles: [],
    currentTeamIndex: 0,
    turnState: {
        hasRevealed: false,
        canGuess: false,
        pendingGuess: null
    },
    winner: null,
    actionLog: [],
    undoStack: []
};

const UIState = {
    importErrors: [],
    confirmAction: null,
    customStatusTimer: null,
    draftQuestions: [],
    editingDraftQuestionIndex: null,
    clearStateConfirming: false,
    resetRoundConfirming: false,
    customAdvancedOpen: false
};

const STORAGE_KEY = "teamGuessingGameState";
const THEME_STORAGE_KEY = "teamGuessingGameTheme";
const TEAM_COLORS = ["#46e5ff", "#ff7fb8", "#f59e0b", "#7c9cff", "#6ee7b7", "#c084fc"];
const ANSWER_FILLER_TOKENS = new Set([
    "opening",
    "line",
    "from",
    "reference",
    "quote",
    "the",
    "a",
    "an",
    "of",
    "to",
    "and",
    "in"
]);

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char]));
}

function normalizePhrase(phrase) {
    return phrase.trim().replace(/\s+/g, " ");
}

function normalizeLabel(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeAnswerText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function tokenizeMeaningfulWords(value) {
    return normalizeAnswerText(value)
        .split(" ")
        .filter(Boolean)
        .filter((token) => !ANSWER_FILLER_TOKENS.has(token));
}

function levenshteinDistance(source, target) {
    if (source === target) {
        return 0;
    }

    if (!source.length) {
        return target.length;
    }

    if (!target.length) {
        return source.length;
    }

    const previousRow = Array.from({ length: target.length + 1 }, (_, index) => index);

    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
        let diagonal = previousRow[0];
        previousRow[0] = sourceIndex + 1;

        for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
            const oldDiagonal = previousRow[targetIndex + 1];
            const substitutionCost = source[sourceIndex] === target[targetIndex] ? 0 : 1;

            previousRow[targetIndex + 1] = Math.min(
                previousRow[targetIndex + 1] + 1,
                previousRow[targetIndex] + 1,
                diagonal + substitutionCost
            );

            diagonal = oldDiagonal;
        }
    }

    return previousRow[target.length];
}

function getStringSimilarity(source, target) {
    const normalizedSource = normalizeAnswerText(source);
    const normalizedTarget = normalizeAnswerText(target);

    if (!normalizedSource || !normalizedTarget) {
        return 0;
    }

    if (normalizedSource === normalizedTarget) {
        return 1;
    }

    const distance = levenshteinDistance(normalizedSource, normalizedTarget);
    return 1 - distance / Math.max(normalizedSource.length, normalizedTarget.length);
}

function isGuessCorrect(guess, answer) {
    const normalizedGuess = normalizeAnswerText(guess);
    const normalizedAnswer = normalizeAnswerText(answer);
    const guessTokens = tokenizeMeaningfulWords(guess);
    const answerTokens = tokenizeMeaningfulWords(answer);

    if (!normalizedGuess || !normalizedAnswer) {
        return false;
    }

    if (guessTokens.length === 0) {
        return false;
    }

    if (normalizedGuess === normalizedAnswer) {
        return true;
    }

    if (answerTokens.length === 1 && guessTokens.length === 1 && (
        normalizedGuess.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedGuess)
    )) {
        return true;
    }

    if (guessTokens.length >= 2 && guessTokens.every((token) => answerTokens.includes(token))) {
        return true;
    }

    if (
        guessTokens.length > 0 &&
        answerTokens.length > 0 &&
        Math.abs(guessTokens.length - answerTokens.length) <= 1
    ) {
        const guessMeaningfulText = guessTokens.join(" ");
        const answerMeaningfulText = answerTokens.join(" ");

        if (getStringSimilarity(guessMeaningfulText, answerMeaningfulText) >= 0.90) {
            return true;
        }
    }

    return false;
}

function getCurrentScreenId() {
    const active = document.querySelector(".screen.active");
    return active ? active.id : "settings-screen";
}

function applyTheme(theme) {
    const normalizedTheme = theme === "light" ? "light" : "dark";
    document.body.classList.toggle("theme-light", normalizedTheme === "light");

    const toggleButton = $("theme-toggle-btn");
    if (toggleButton) {
        const isLight = normalizedTheme === "light";
        toggleButton.textContent = isLight ? "Dark Mode" : "Light Mode";
        toggleButton.setAttribute("aria-pressed", String(isLight));
        toggleButton.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    }
}

function saveThemePreference(theme) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
        console.error("Failed to save theme preference:", error);
    }
}

function loadThemePreference() {
    try {
        const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        return storedTheme === "light" ? "light" : "dark";
    } catch (error) {
        console.error("Failed to load theme preference:", error);
        return "dark";
    }
}

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((screen) => {
        screen.classList.remove("active");
    });

    $(screenId).classList.add("active");
    document.body.classList.toggle("screen-game-active", screenId === "game-screen");
}

function getRoundDisplayName(round) {
    if (!round) {
        return "";
    }

    return normalizeLabel(round.displayName || round.id);
}

function getTeamAccent(index) {
    return TEAM_COLORS[index % TEAM_COLORS.length];
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const value = normalized.length === 3
        ? normalized.split("").map((char) => `${char}${char}`).join("")
        : normalized;
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function slugifyRoundName(value) {
    return normalizeAnswerText(value).replace(/\s+/g, "-");
}

function getUniqueRoundId(displayName) {
    const baseSlug = slugifyRoundName(displayName);
    if (!baseSlug) {
        return "";
    }

    if (!GameState.deck || !GameState.deck.rounds.some((round) => round.id === baseSlug)) {
        return baseSlug;
    }

    let suffix = 2;
    while (GameState.deck.rounds.some((round) => round.id === `${baseSlug}-${suffix}`)) {
        suffix += 1;
    }

    return `${baseSlug}-${suffix}`;
}

function createActionLogEntry(type, message) {
    return {
        type,
        message,
        timestamp: Date.now()
    };
}

function pushActionLog(type, message) {
    GameState.actionLog.push(createActionLogEntry(type, message));
}

function normalizeSavedActionLog(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    return entries.map((entry) => {
        if (entry && typeof entry === "object" && typeof entry.message === "string") {
            return {
                type: entry.type || "system",
                message: entry.message,
                timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now()
            };
        }

        return createActionLogEntry("system", String(entry));
    });
}

function formatLogTimestamp(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

function getQuestionCount(round) {
    if (!round) {
        return 0;
    }

    if (Array.isArray(round.questions)) {
        return round.questions.length;
    }

    return round.phrase || round.answer ? 1 : 0;
}

function getLegacyQuestionFromRound(round) {
    return {
        id: round.questionId || `${round.id || "round"}-question-1`,
        ...(typeof round.wordCount === "number" ? { wordCount: round.wordCount } : {}),
        phrase: round.phrase,
        answer: round.answer
    };
}

function getRoundQuestions(round) {
    if (!round) {
        return [];
    }

    if (Array.isArray(round.questions)) {
        return round.questions;
    }

    if (round.phrase || round.answer) {
        return [getLegacyQuestionFromRound(round)];
    }

    return [];
}

function normalizeQuestion(question, roundId, inheritedWordCount, index) {
    const normalized = {
        id: question.id || `${roundId}-question-${index + 1}`,
        phrase: typeof question.phrase === "string" ? normalizePhrase(question.phrase) : question.phrase,
        answer: question.answer
    };

    const effectiveWordCount = question.wordCount ?? inheritedWordCount;
    if (typeof effectiveWordCount === "number") {
        normalized.wordCount = effectiveWordCount;
    }

    return normalized;
}

function normalizeRound(round, index, defaultWordCount) {
    const roundId = round.id || `round-${index + 1}`;
    const inheritedWordCount = round.wordCount ?? defaultWordCount;
    const questions = getRoundQuestions(round).map((question, questionIndex) =>
        normalizeQuestion(question, roundId, inheritedWordCount, questionIndex)
    );
    const displayName = typeof round.displayName === "string" ? normalizeLabel(round.displayName) : "";

    return {
        id: roundId,
        ...(displayName ? { displayName } : {}),
        questions
    };
}

function normalizeDeck(deck) {
    return {
        title: deck.title,
        defaultWordCount: deck.defaultWordCount,
        rounds: Array.isArray(deck.rounds)
            ? deck.rounds.map((round, index) => normalizeRound(round, index, deck.defaultWordCount))
            : []
    };
}

function getQuestionWordCount(question) {
    return question.wordCount || GameState.deck.defaultWordCount;
}

function getQuestionWords(question) {
    return normalizePhrase(question.phrase).split(" ").filter(Boolean);
}

function getCurrentRound() {
    if (!GameState.deck || !GameState.currentRoundId) {
        return null;
    }

    return GameState.deck.rounds.find((round) => round.id === GameState.currentRoundId) || null;
}

function getCurrentQuestion() {
    const round = getCurrentRound();
    if (!round) {
        return null;
    }

    const questions = getRoundQuestions(round);
    return questions[GameState.currentQuestionIndex] || null;
}

function getRevealProgress() {
    const question = getCurrentQuestion();
    const total = question ? getQuestionWordCount(question) : 0;
    const revealed = GameState.revealedTiles.length;
    return {
        total,
        revealed,
        remaining: Math.max(total - revealed, 0)
    };
}

function getRoundProgressLabel(round) {
    const totalQuestions = getQuestionCount(round);
    if (!totalQuestions) {
        return "No questions";
    }

    return `Question ${GameState.currentQuestionIndex + 1} of ${totalQuestions}`;
}

function hasNextQuestionInRound() {
    const round = getCurrentRound();
    return Boolean(round) && GameState.currentQuestionIndex < getQuestionCount(round) - 1;
}

function getTurnInstruction() {
    const round = getCurrentRound();
    const totalQuestions = getQuestionCount(round);

    if (GameState.winner) {
        return {
            tone: "ready",
            text: hasNextQuestionInRound()
                ? `Claimed this question. Move to question ${GameState.currentQuestionIndex + 2} of ${totalQuestions} when you're ready.`
                : `Claimed the final question in this round. Move on when you're ready.`
        };
    }

    if (GameState.turnState.pendingGuess !== null) {
        return {
            tone: "waiting",
            text: `Locked in a guess for ${getRoundProgressLabel(round).toLowerCase()}. The answer is being checked automatically.`
        };
    }

    if (GameState.turnState.canGuess) {
        return {
            tone: "ready",
            text: `Reveal complete for ${getRoundProgressLabel(round).toLowerCase()}. Enter the guess and the app will check it automatically.`
        };
    }

    return {
        tone: "locked",
        text: `Reveal a clue to begin ${getRoundProgressLabel(round).toLowerCase()}.`
    };
}

function getTotalQuestionCount(deck) {
    if (!deck || !Array.isArray(deck.rounds)) {
        return 0;
    }

    return deck.rounds.reduce((sum, round) => sum + getQuestionCount(round), 0);
}

function showToast(message, tone = "info") {
    const region = $("toast-region");
    const toast = document.createElement("div");
    toast.className = `toast toast-${tone}`;
    toast.textContent = message;
    region.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

function setBanner(element, { message = "", tone = "info", hidden = false }) {
    element.hidden = hidden || !message;
    element.className = "status-banner";

    if (hidden || !message) {
        element.textContent = "";
        return;
    }

    if (tone === "success") {
        element.classList.add("status-banner-success");
    } else if (tone === "error") {
        element.classList.add("status-banner-error");
    } else if (tone === "warning") {
        element.classList.add("status-banner-warning");
    }

    element.textContent = message;
}

function openConfirmModal({ title, body, confirmLabel = "Confirm", confirmClass = "btn-primary", onConfirm }) {
    UIState.confirmAction = onConfirm || null;
    $("feedback-modal-title").textContent = title;
    $("feedback-modal-body").textContent = body;

    const confirmButton = $("feedback-modal-confirm");
    confirmButton.textContent = confirmLabel;
    confirmButton.className = `btn ${confirmClass}`;

    $("feedback-modal").hidden = false;
}

function closeConfirmModal() {
    UIState.confirmAction = null;
    $("feedback-modal").hidden = true;
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            deck: GameState.deck,
            teams: GameState.teams,
            wordCount: GameState.wordCount,
            currentRoundId: GameState.currentRoundId,
            currentQuestionIndex: GameState.currentQuestionIndex,
            revealedTiles: GameState.revealedTiles,
            currentTeamIndex: GameState.currentTeamIndex,
            turnState: GameState.turnState,
            winner: GameState.winner,
            actionLog: GameState.actionLog
        }));
    } catch (error) {
        console.error("Failed to save state:", error);
        showToast("Could not save the current session.", "error");
    }
}

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            return false;
        }

        const state = JSON.parse(saved);
        GameState.deck = state.deck ? normalizeDeck(state.deck) : null;
        GameState.teams = Array.isArray(state.teams) && state.teams.length >= 2 ? state.teams : ["Team 1", "Team 2"];
        GameState.wordCount = state.wordCount || 10;
        GameState.currentRoundId = state.currentRoundId;
        GameState.currentQuestionIndex = Number.isInteger(state.currentQuestionIndex) ? state.currentQuestionIndex : 0;
        GameState.revealedTiles = state.revealedTiles || [];
        GameState.currentTeamIndex = state.currentTeamIndex || 0;
        GameState.turnState = state.turnState || {
            hasRevealed: false,
            canGuess: false,
            pendingGuess: null
        };
        GameState.winner = state.winner;
        GameState.actionLog = normalizeSavedActionLog(state.actionLog || []);
        return true;
    } catch (error) {
        console.error("Failed to load state:", error);
        showToast("Saved state could not be restored.", "warning");
        return false;
    }
}

function clearState() {
    localStorage.removeItem(STORAGE_KEY);
    GameState.deck = null;
    GameState.teams = ["Team 1", "Team 2"];
    GameState.wordCount = 10;
    GameState.currentRoundId = null;
    GameState.currentQuestionIndex = 0;
    GameState.revealedTiles = [];
    GameState.currentTeamIndex = 0;
    GameState.turnState = {
        hasRevealed: false,
        canGuess: false,
        pendingGuess: null
    };
    GameState.winner = null;
    GameState.actionLog = [];
    GameState.undoStack = [];
    UIState.importErrors = [];
    UIState.draftQuestions = [];
    UIState.editingDraftQuestionIndex = null;
    UIState.clearStateConfirming = false;
    UIState.resetRoundConfirming = false;
    UIState.customAdvancedOpen = false;
}

function validateDeck(deck) {
    const errors = [];

    if (!deck || typeof deck !== "object") {
        return { valid: false, errors: [{ roundId: null, reason: "Invalid deck format" }] };
    }

    if (!deck.title || typeof deck.title !== "string") {
        errors.push({ roundId: null, reason: "Missing or invalid title" });
    }

    if (typeof deck.defaultWordCount !== "number" || deck.defaultWordCount < 10 || deck.defaultWordCount > 30) {
        errors.push({ roundId: null, reason: "defaultWordCount must be a number between 10 and 30" });
    }

    if (!Array.isArray(deck.rounds) || deck.rounds.length === 0) {
        errors.push({ roundId: null, reason: "Deck must contain at least one round" });
        return { valid: false, errors };
    }

    deck.rounds.forEach((round, index) => {
        const roundId = round.id || `round-${index + 1}`;
        const questions = getRoundQuestions(round);

        if (!round.id) {
            errors.push({ roundId, reason: "Missing round id" });
        }

        if (round.displayName !== undefined && typeof round.displayName !== "string") {
            errors.push({ roundId, reason: "displayName must be a string when provided" });
        }

        if (questions.length === 0) {
            errors.push({ roundId, reason: "Round must contain at least one question" });
            return;
        }

        questions.forEach((question, questionIndex) => {
            const questionLabel = questions.length > 1 ? `${roundId} / Question ${questionIndex + 1}` : roundId;
            const wordCount = question.wordCount ?? round.wordCount ?? deck.defaultWordCount;

            if (typeof wordCount !== "number" || wordCount < 10 || wordCount > 30) {
                errors.push({ roundId: questionLabel, reason: `Invalid wordCount: ${wordCount}` });
            }

            if (!question.phrase || typeof question.phrase !== "string") {
                errors.push({ roundId: questionLabel, reason: "Missing or invalid phrase" });
            } else {
                const normalizedPhrase = normalizePhrase(question.phrase);
                const words = normalizedPhrase.split(" ").filter(Boolean);

                if (words.length !== wordCount) {
                    errors.push({
                        roundId: questionLabel,
                        reason: `Phrase has ${words.length} words, expected ${wordCount}`
                    });
                }
            }

            if (!question.answer || typeof question.answer !== "string") {
                errors.push({ roundId: questionLabel, reason: "Missing or invalid answer" });
            }
        });
    });

    return {
        valid: errors.length === 0,
        errors
    };
}

function pushUndoAction(type, data) {
    GameState.undoStack.push({ type, data, timestamp: Date.now() });

    if (GameState.undoStack.length > 50) {
        GameState.undoStack.shift();
    }
}

function resetQuestionState() {
    GameState.revealedTiles = [];
    GameState.currentTeamIndex = 0;
    GameState.turnState = {
        hasRevealed: false,
        canGuess: false,
        pendingGuess: null
    };
    GameState.winner = null;
    GameState.actionLog = [];
    GameState.undoStack = [];
}

function undoLastAction() {
    if (GameState.undoStack.length === 0) {
        showToast("There is nothing to undo right now.", "warning");
        return false;
    }

    const action = GameState.undoStack.pop();

    switch (action.type) {
        case "reveal":
            GameState.revealedTiles = GameState.revealedTiles.filter((index) => index !== action.data.tileIndex);
            GameState.turnState.hasRevealed = false;
            GameState.turnState.canGuess = false;
            GameState.actionLog.pop();
            saveState();
            renderGameScreen();
            showToast("Last reveal undone.", "success");
            return true;

        case "markWrong":
            GameState.currentTeamIndex = action.data.previousTeamIndex;
            GameState.turnState.hasRevealed = false;
            GameState.turnState.canGuess = false;
            GameState.turnState.pendingGuess = null;
            GameState.actionLog.pop();
            saveState();
            renderGameScreen();
            showToast("Wrong-answer call undone.", "success");
            return true;

        case "markCorrect":
            GameState.winner = null;
            GameState.currentTeamIndex = action.data.previousTeamIndex;
            GameState.turnState = { ...action.data.previousTurnState };
            GameState.actionLog.pop();
            saveState();
            showScreen("game-screen");
            renderGameScreen();
            showToast("Winning call undone.", "success");
            return true;

        case "autoWrong":
            GameState.currentTeamIndex = action.data.previousTeamIndex;
            GameState.turnState = { ...action.data.previousTurnState };
            GameState.winner = action.data.previousWinner ?? null;
            GameState.actionLog = GameState.actionLog.slice(0, action.data.previousActionLogLength);
            saveState();
            renderGameScreen();
            showToast("Automatic wrong-call undone.", "success");
            return true;

        case "autoCorrect":
            GameState.currentTeamIndex = action.data.previousTeamIndex;
            GameState.turnState = { ...action.data.previousTurnState };
            GameState.winner = action.data.previousWinner ?? null;
            GameState.actionLog = GameState.actionLog.slice(0, action.data.previousActionLogLength);
            saveState();
            showScreen("game-screen");
            renderGameScreen();
            showToast("Automatic correct-call undone.", "success");
            return true;

        default:
            return false;
    }
}

function startRound(roundId, questionIndex = 0) {
    if (!GameState.deck) {
        showToast("Load a valid deck before starting a round.", "error");
        return false;
    }

    const round = GameState.deck.rounds.find((entry) => entry.id === roundId);
    if (!round) {
        showToast("That round could not be found.", "error");
        return false;
    }

    const questions = getRoundQuestions(round);
    if (!questions.length) {
        showToast("That round has no playable questions.", "error");
        return false;
    }

    GameState.currentRoundId = roundId;
    GameState.currentQuestionIndex = Math.min(Math.max(questionIndex, 0), questions.length - 1);
    resetQuestionState();
    GameState.wordCount = getQuestionWordCount(questions[GameState.currentQuestionIndex]);

    saveState();
    showScreen("game-screen");
    renderGameScreen();
    showToast(`${getRoundDisplayName(round)} · Question ${GameState.currentQuestionIndex + 1} of ${questions.length} is live.`, "success");
    return true;
}

function revealTile(tileIndex) {
    const question = getCurrentQuestion();
    if (!question) {
        return false;
    }

    if (GameState.turnState.hasRevealed) {
        showToast("You can only reveal one tile per turn.", "warning");
        return false;
    }

    if (tileIndex < 1 || tileIndex > getQuestionWordCount(question)) {
        return false;
    }

    if (GameState.revealedTiles.includes(tileIndex)) {
        return false;
    }

    GameState.revealedTiles.push(tileIndex);
    GameState.turnState.hasRevealed = true;
    GameState.turnState.canGuess = true;

    const word = getQuestionWords(question)[tileIndex - 1];
    const currentTeam = GameState.teams[GameState.currentTeamIndex];
    pushActionLog("reveal", `${currentTeam} revealed tile #${tileIndex}: ${word}`);
    pushUndoAction("reveal", { tileIndex });

    saveState();
    renderGameScreen();
    return true;
}

function submitGuess(rawGuess) {
    const question = getCurrentQuestion();
    if (!question) {
        return false;
    }

    if (!GameState.turnState.canGuess) {
        showToast("Reveal a tile before submitting a guess.", "warning");
        return false;
    }

    if (GameState.turnState.pendingGuess !== null) {
        showToast("This turn already has a locked guess.", "warning");
        return false;
    }

    const normalizedGuess = rawGuess.trim();
    if (!normalizedGuess) {
        showToast("Enter a guess before locking it in.", "warning");
        return false;
    }

    const currentTeam = GameState.teams[GameState.currentTeamIndex];
    const undoSnapshot = {
        previousTeamIndex: GameState.currentTeamIndex,
        previousTurnState: { ...GameState.turnState },
        previousWinner: GameState.winner,
        previousActionLogLength: GameState.actionLog.length
    };

    GameState.turnState.pendingGuess = normalizedGuess;
    pushActionLog("guess", `${currentTeam} guessed: "${normalizedGuess}"`);

    if (isGuessCorrect(normalizedGuess, question.answer)) {
        pushUndoAction("autoCorrect", undoSnapshot);
        GameState.winner = currentTeam;
        pushActionLog("correct", `${currentTeam} guessed correctly. Answer: "${question.answer}"`);
        saveState();
        showScreen("end-screen");
        renderEndScreen();
        showToast(`${currentTeam} wins this question!`, "success");
        return true;
    }

    pushUndoAction("autoWrong", undoSnapshot);
    GameState.currentTeamIndex = (GameState.currentTeamIndex + 1) % GameState.teams.length;
    GameState.turnState.hasRevealed = false;
    GameState.turnState.canGuess = false;
    GameState.turnState.pendingGuess = null;
    pushActionLog("wrong", `${currentTeam} guessed wrong. Control passes to the next team.`);
    saveState();
    renderGameScreen();
    showToast("Answer checked automatically. Turn passed to the next team.", "warning");
    return true;
}

function revealAllTiles() {
    const question = getCurrentQuestion();
    if (!question) {
        return false;
    }

    const wordCount = getQuestionWordCount(question);
    for (let index = 1; index <= wordCount; index += 1) {
        if (!GameState.revealedTiles.includes(index)) {
            GameState.revealedTiles.push(index);
        }
    }

    pushActionLog("system", "Host revealed every tile on the board.");
    saveState();
    renderGameScreen();
    showToast("All tiles revealed.", "success");
    return true;
}

function resetRound() {
    resetQuestionState();
    saveState();
    renderGameScreen();
    showToast("Question reset to the opening turn.", "success");
}

function leaveRoundFlow() {
    GameState.currentRoundId = null;
    GameState.currentQuestionIndex = 0;
    resetQuestionState();
    saveState();
    showScreen("settings-screen");
    renderSettingsScreen();
}

function advanceToNextQuestionOrSetup() {
    const round = getCurrentRound();
    if (!round) {
        leaveRoundFlow();
        return;
    }

    if (hasNextQuestionInRound()) {
        startRound(round.id, GameState.currentQuestionIndex + 1);
        return;
    }

    leaveRoundFlow();
    showToast(`Finished all questions in ${getRoundDisplayName(round)}.`, "success");
}

function renderSetupStepper() {
    const validation = GameState.deck ? validateDeck(GameState.deck) : { valid: false };
    const hasValidTeams = GameState.teams.length >= 2 && GameState.teams.every((team) => normalizeLabel(team).length > 0);
    const hasDraftWork = Boolean(
        UIState.draftQuestions.length ||
        normalizeLabel($("custom-round-id")?.value || "") ||
        normalizeLabel($("custom-round-phrase")?.value || "") ||
        normalizeLabel($("custom-round-answer")?.value || "")
    );

    let currentStep = 1;
    if (GameState.wordCount >= 10 && GameState.wordCount <= 30) {
        currentStep = 2;
    }
    if (hasValidTeams) {
        currentStep = 3;
    }
    if (hasDraftWork && !validation.valid) {
        currentStep = 4;
    }
    if (validation.valid) {
        currentStep = 5;
    }

    document.querySelectorAll(".setup-step").forEach((step) => {
        const stepNumber = Number(step.dataset.step);
        step.classList.toggle("is-complete", stepNumber < currentStep);
        step.classList.toggle("is-current", stepNumber === currentStep);
    });
}

function renderSetupSummary() {
    const validation = GameState.deck ? validateDeck(GameState.deck) : null;
    const roundCount = GameState.deck ? GameState.deck.rounds.length : null;

    $("setup-word-count-stat").textContent = String(GameState.wordCount);
    $("setup-team-count-stat").textContent = String(GameState.teams.length);
    $("setup-round-count-stat").textContent = roundCount === null ? "—" : String(roundCount);
    $("setup-round-count-help").textContent = roundCount === null
        ? "Load a deck to see round count."
        : validation && validation.valid
            ? `${roundCount} round${roundCount === 1 ? "" : "s"} ready to launch.`
            : "Deck loaded. Review issues below before launch.";
    renderSetupStepper();
}

function renderTeamsList() {
    const container = $("teams-list");
    container.innerHTML = "";

    GameState.teams.forEach((team, index) => {
        const row = document.createElement("div");
        row.className = "team-row";
        row.style.setProperty("--team-accent", getTeamAccent(index));
        row.style.setProperty("--team-accent-soft", hexToRgba(getTeamAccent(index), 0.18));
        row.style.setProperty("--team-accent-border", hexToRgba(getTeamAccent(index), 0.4));
        row.innerHTML = `
            <div class="team-badge">${index + 1}</div>
            <input type="text" class="team-name-input" data-index="${index}" value="${escapeHtml(team)}" placeholder="Team name">
            <button class="btn btn-ghost remove-team-btn" type="button" data-index="${index}" ${GameState.teams.length <= 2 ? "disabled" : ""}>Remove</button>
        `;
        container.appendChild(row);
    });

    container.querySelectorAll(".team-name-input").forEach((input) => {
        input.addEventListener("input", (event) => {
            const index = Number(event.target.dataset.index);
            GameState.teams[index] = event.target.value.trim() || `Team ${index + 1}`;
            saveState();
            renderSetupSummary();
            if (getCurrentScreenId() === "game-screen") {
                renderGameScreen();
            }
        });
    });

    container.querySelectorAll(".remove-team-btn").forEach((button) => {
        button.addEventListener("click", (event) => {
            const index = Number(event.target.dataset.index);
            if (GameState.teams.length <= 2) {
                return;
            }

            GameState.teams.splice(index, 1);
            if (GameState.currentTeamIndex >= GameState.teams.length) {
                GameState.currentTeamIndex = 0;
            }

            saveState();
            renderSettingsScreen();
        });
    });
}

function renderDeckMeta(validation) {
    const meta = $("deck-meta");
    meta.innerHTML = "";

    if (!GameState.deck || !validation.valid) {
        meta.hidden = true;
        return;
    }

    meta.hidden = false;
    meta.innerHTML = `
        <div class="meta-card">
            <strong>${escapeHtml(GameState.deck.title)}</strong>
            <span>Deck title</span>
        </div>
        <div class="meta-card">
            <strong>${escapeHtml(GameState.deck.rounds.length)}</strong>
            <span>Rounds ready to play</span>
        </div>
        <div class="meta-card">
            <strong>${escapeHtml(getTotalQuestionCount(GameState.deck))}</strong>
            <span>Total questions across the deck</span>
        </div>
    `;
}

function updateDeckStatus() {
    const status = $("deck-status");
    const errors = $("validation-errors");
    const exportButton = $("export-deck-btn");
    const launchStatus = $("launch-status-pill");

    exportButton.disabled = true;

    if (!GameState.deck) {
        status.hidden = false;
        status.className = `status-banner ${UIState.importErrors.length ? "status-banner-error" : "status-banner-warning"}`;
        status.innerHTML = UIState.importErrors.length
            ? `<div class="status-banner-copy"><span class="status-banner-icon" aria-hidden="true">!</span><p>Deck import failed. Review the validation issues below.</p></div>`
            : `<div class="status-banner-copy"><span class="status-banner-icon" aria-hidden="true">!</span><p>No deck loaded — import a file or build a custom round below to unlock launch.</p></div>`;

        if (UIState.importErrors.length) {
            errors.hidden = false;
            errors.className = "status-banner status-banner-error";
            errors.innerHTML = `<strong>Validation Issues</strong><ul class="validation-list">${UIState.importErrors.map((error) => `<li>Round ${escapeHtml(error.roundId || "N/A")}: ${escapeHtml(error.reason)}</li>`).join("")}</ul>`;
        } else {
            errors.hidden = true;
            errors.textContent = "";
        }

        $("deck-meta").hidden = true;
        launchStatus.textContent = "Deck Needed";
        return;
    }

    const validation = validateDeck(GameState.deck);
    renderDeckMeta(validation);

    if (validation.valid) {
        setBanner(status, {
            message: `Deck loaded: "${GameState.deck.title}" with ${GameState.deck.rounds.length} rounds and ${getTotalQuestionCount(GameState.deck)} total questions.`,
            tone: "success"
        });
        errors.hidden = true;
        errors.textContent = "";
        exportButton.disabled = false;
        launchStatus.textContent = "Launch Ready";
    } else {
        setBanner(status, {
            message: `Deck "${GameState.deck.title}" has validation problems that block launch.`,
            tone: "error"
        });
        errors.hidden = false;
        errors.className = "status-banner status-banner-error";
        errors.innerHTML = `<strong>Validation Issues</strong><ul class="validation-list">${validation.errors.map((error) => `<li>Round ${escapeHtml(error.roundId || "N/A")}: ${escapeHtml(error.reason)}</li>`).join("")}</ul>`;
        exportButton.disabled = true;
        launchStatus.textContent = "Fix Deck";
    }
}

function renderRoundSelection() {
    const select = $("round-select");
    const startSelected = $("start-selected-btn");
    const startRandom = $("start-random-btn");

    select.innerHTML = '<option value="">No deck loaded</option>';
    select.disabled = true;
    startSelected.disabled = true;
    startRandom.disabled = true;
    select.title = "Load a deck first.";
    startSelected.title = "Load a deck first.";
    startRandom.title = "Load a deck first.";
    renderRoundPreviewEmpty("Load a deck first.");

    if (!GameState.deck) {
        return;
    }

    const validation = validateDeck(GameState.deck);
    if (!validation.valid) {
        renderRoundPreviewEmpty("Fix the validation issues above before launching a round.");
        return;
    }

    select.disabled = false;
    startSelected.disabled = false;
    startRandom.disabled = false;
    select.title = "";
    startSelected.title = "";
    startRandom.title = "";

    GameState.deck.rounds.forEach((round) => {
        const option = document.createElement("option");
        option.value = round.id;
        option.textContent = `${getRoundDisplayName(round)} (${getQuestionCount(round)} ${getQuestionCount(round) === 1 ? "question" : "questions"})`;
        if (round.id === GameState.currentRoundId) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    if (!select.value && GameState.deck.rounds.length > 0) {
        select.value = GameState.deck.rounds[0].id;
    }

    updateRoundPreview();
}

function renderRoundPreviewEmpty(message) {
    const preview = $("round-preview");
    preview.className = "round-preview-card compact-empty";
    preview.innerHTML = `<div class="round-preview-empty-shell"><p>${escapeHtml(message)}</p></div>`;
}

function updateRoundPreview() {
    const roundId = $("round-select").value;

    if (!GameState.deck || !roundId) {
        renderRoundPreviewEmpty("Select a round to see its question lineup.");
        return;
    }

    const round = GameState.deck.rounds.find((entry) => entry.id === roundId);
    if (!round) {
        renderRoundPreviewEmpty("That round could not be found.");
        return;
    }

    const questions = getRoundQuestions(round);
    const preview = $("round-preview");
    preview.className = "round-preview-card";
    preview.innerHTML = `
        <div class="preview-row">
            <div class="stat-chip compact">
                <span class="stat-label">Round</span>
                <span class="stat-value">${escapeHtml(getRoundDisplayName(round))}</span>
            </div>
            <div class="stat-chip compact">
                <span class="stat-label">Questions</span>
                <span class="stat-value">${escapeHtml(questions.length)}</span>
            </div>
        </div>
        <div class="question-list">
            ${questions.map((question, index) => `
                <div class="question-card">
                    <div class="preview-card-header">
                        <div>
                            <div class="question-card-title">Question ${index + 1}</div>
                            <div class="question-card-copy">${escapeHtml(question.phrase)}</div>
                        </div>
                        <span class="word-count-chip ${getQuestionWordCount(question) === GameState.wordCount ? "match" : "mismatch"}">${getQuestionWordCount(question) === GameState.wordCount ? "✓" : "⚠"} ${escapeHtml(getQuestionWordCount(question))} words${getQuestionWordCount(question) === GameState.wordCount ? "" : ` (expected ${escapeHtml(GameState.wordCount)})`}</span>
                    </div>
                    <div class="question-card-answer"><strong>Answer:</strong> ${escapeHtml(question.answer)}</div>
                </div>
            `).join("")}
        </div>
    `;
}

function resetCustomQuestionEditor() {
    $("custom-round-phrase").value = "";
    $("custom-round-answer").value = "";
    $("custom-round-word-count").value = "";
    UIState.editingDraftQuestionIndex = null;
    $("custom-question-editor-title").textContent = "Add a question";
    $("add-custom-round-btn").textContent = "Add Question To Round";
    setCustomAdvancedState(false);
    updateCustomWordCountHint();
}

function renderDraftQuestionList() {
    const list = $("custom-round-question-list");
    const emptyState = $("custom-round-question-empty");
    const count = $("custom-round-question-count");

    list.innerHTML = "";
    count.textContent = `Questions Added: ${UIState.draftQuestions.length}`;

    if (UIState.draftQuestions.length === 0) {
        emptyState.hidden = false;
        updateSaveRoundState();
        return;
    }

    emptyState.hidden = true;

    UIState.draftQuestions.forEach((question, index) => {
        const phrasePreview = question.phrase.length > 40 ? `${question.phrase.slice(0, 40)}...` : question.phrase;
        const item = document.createElement("div");
        item.className = "question-card";
        item.innerHTML = `
            <div class="question-card-header">
                <div class="question-card-summary">
                    <div class="question-card-title">Question ${index + 1}</div>
                    <div class="question-card-copy question-truncate">${escapeHtml(phrasePreview)}</div>
                </div>
                <span class="word-count-chip match">${escapeHtml(getQuestionWordCount(question))} words</span>
            </div>
            <div class="question-card-answer"><strong>Answer:</strong> ${escapeHtml(question.answer)}</div>
            <div class="question-card-actions">
                <button type="button" class="btn btn-ghost edit-draft-question-btn" data-index="${index}">Edit</button>
                <button type="button" class="btn btn-ghost question-card-remove remove-draft-question-btn" data-index="${index}" aria-label="Remove question ${index + 1}">&times;</button>
            </div>
        `;
        list.appendChild(item);
    });

    list.querySelectorAll(".edit-draft-question-btn").forEach((button) => {
        button.addEventListener("click", (event) => {
            const index = Number(event.target.dataset.index);
            const question = UIState.draftQuestions[index];
            if (!question) {
                return;
            }

            UIState.editingDraftQuestionIndex = index;
            $("custom-round-phrase").value = question.phrase;
            $("custom-round-answer").value = question.answer;
            $("custom-round-word-count").value = question.wordCount || "";
            $("custom-question-editor-title").textContent = `Edit question ${index + 1}`;
            $("add-custom-round-btn").textContent = "Update Question";
            setCustomAdvancedState(Boolean(question.wordCount));
            updateCustomWordCountHint();
        });
    });

    list.querySelectorAll(".remove-draft-question-btn").forEach((button) => {
        button.addEventListener("click", (event) => {
            const index = Number(event.target.dataset.index);
            UIState.draftQuestions.splice(index, 1);

            if (UIState.editingDraftQuestionIndex === index) {
                resetCustomQuestionEditor();
            } else if (UIState.editingDraftQuestionIndex !== null && UIState.editingDraftQuestionIndex > index) {
                UIState.editingDraftQuestionIndex -= 1;
            }

            renderDraftQuestionList();
            showCustomRoundStatus("Question removed from the draft round.", "success");
            renderSetupStepper();
        });
    });

    updateSaveRoundState();
}

function renderSettingsScreen() {
    $("word-count").value = GameState.wordCount;
    setClearStateConfirmationVisible(false);
    renderSetupSummary();
    renderTeamsList();
    updateDeckStatus();
    renderRoundSelection();
    renderDraftQuestionList();
    updateCustomWordCountHint();
    updateSaveRoundState();
    renderSetupStepper();
}

function renderTiles() {
    const question = getCurrentQuestion();
    if (!question) {
        return;
    }

    const container = $("tiles-grid");
    const wordCount = getQuestionWordCount(question);
    const words = getQuestionWords(question);
    const latestRevealedTile = GameState.revealedTiles[GameState.revealedTiles.length - 1];
    container.innerHTML = "";

    for (let index = 1; index <= wordCount; index += 1) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "tile";
        tile.dataset.index = String(index);

        const isRevealed = GameState.revealedTiles.includes(index);
        const isDisabled = GameState.winner !== null || GameState.turnState.pendingGuess !== null || GameState.turnState.hasRevealed;

        if (isRevealed) {
            tile.classList.add("revealed");
            tile.innerHTML = `
                <div class="tile-number">${index}</div>
                <div class="tile-word">${escapeHtml(words[index - 1])}</div>
            `;
            tile.disabled = true;
        } else {
            tile.classList.add("hidden");
            tile.innerHTML = `
                <div class="tile-number">${index}</div>
                <div class="tile-symbol">?</div>
            `;
            tile.disabled = isDisabled;
        }

        if (isRevealed && latestRevealedTile === index) {
            tile.classList.add("latest");
        }

        if (isDisabled && !isRevealed) {
            tile.classList.add("disabled");
        }

        if (!isRevealed && !isDisabled) {
            tile.addEventListener("click", () => {
                revealTile(index);
            });
        }

        container.appendChild(tile);
    }
}

function renderActionLog() {
    const container = $("action-log");
    const emptyState = $("action-log-empty");

    container.innerHTML = "";

    if (GameState.actionLog.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    GameState.actionLog.forEach((entry) => {
        const item = document.createElement("div");
        item.className = `action-log-entry action-log-entry-${entry.type || "system"}`;
        item.innerHTML = `
            <div class="action-log-timestamp">${escapeHtml(formatLogTimestamp(entry.timestamp))}</div>
            <div class="action-log-message">${escapeHtml(entry.message)}</div>
        `;
        container.appendChild(item);
    });

    container.scrollTop = container.scrollHeight;
}

function updateGuessSubmitButtonState() {
    const guessInput = $("guess-input");
    const submitButton = $("submit-guess-btn");
    const hasValue = Boolean(guessInput.value.trim());
    const canSubmit = !guessInput.disabled;

    submitButton.disabled = !canSubmit;
    submitButton.classList.remove("btn-primary", "btn-secondary", "btn-pulse");
    submitButton.classList.add(canSubmit && hasValue ? "btn-primary" : "btn-secondary");

    if (canSubmit && hasValue) {
        submitButton.classList.add("btn-pulse");
    }
}

function renderGameScreen() {
    const round = getCurrentRound();
    const question = getCurrentQuestion();
    if (!round || !question) {
        showScreen("settings-screen");
        renderSettingsScreen();
        return;
    }

    setResetRoundConfirmationVisible(false);
    renderSetupSummary();

    const currentTeam = GameState.teams[GameState.currentTeamIndex];
    const currentTeamAccent = getTeamAccent(GameState.currentTeamIndex);
    const progress = getRevealProgress();
    const instruction = getTurnInstruction();
    const totalQuestions = getQuestionCount(round);
    const roundLabel = getRoundDisplayName(round);

    $("current-team-name").textContent = currentTeam;
    $("current-team-name").style.color = currentTeamAccent;
    $("current-team-name").parentElement.style.setProperty("--team-accent", currentTeamAccent);
    $("game-round-id").textContent = `${roundLabel} · Q${GameState.currentQuestionIndex + 1}/${totalQuestions}`;
    $("game-subtitle").textContent = `${GameState.deck.title} · ${roundLabel} · Question ${GameState.currentQuestionIndex + 1} of ${totalQuestions}`;
    $("reveal-count").textContent = String(progress.revealed);
    $("remaining-count").textContent = String(progress.remaining);
    $("board-progress-label").textContent = `${progress.revealed} / ${progress.total}`;
    $("board-progress-bar").style.width = progress.total ? `${(progress.revealed / progress.total) * 100}%` : "0%";

    const instructionBanner = $("turn-instruction");
    instructionBanner.innerHTML = `<span class="team-name-highlight">${escapeHtml(currentTeam)}</span> — ${escapeHtml(instruction.text)}`;
    instructionBanner.className = `instruction-banner ${instruction.tone}`;
    instructionBanner.style.setProperty("--team-accent", currentTeamAccent);

    const guessInput = $("guess-input");
    const submitButton = $("submit-guess-btn");
    const canSubmitGuess = !GameState.winner && GameState.turnState.canGuess && GameState.turnState.pendingGuess === null;

    guessInput.disabled = !canSubmitGuess;
    guessInput.value = GameState.turnState.pendingGuess || "";
    $("guess-team-label").textContent = `${currentTeam} is guessing`;
    $("guess-team-label").style.setProperty("--team-accent", currentTeamAccent);

    if (GameState.turnState.pendingGuess !== null) {
        $("guess-help").textContent = `Answer check is running for question ${GameState.currentQuestionIndex + 1} of ${totalQuestions}.`;
    } else if (GameState.turnState.canGuess) {
        $("guess-help").textContent = `Clue revealed for question ${GameState.currentQuestionIndex + 1}. Enter the guess and it will be checked automatically.`;
    } else {
        $("guess-help").textContent = `Reveal a tile to unlock guessing for question ${GameState.currentQuestionIndex + 1}.`;
    }

    $("undo-btn").disabled = GameState.undoStack.length === 0;
    updateGuessSubmitButtonState();

    renderTiles();
    renderActionLog();
}

function renderEndScreen() {
    const round = getCurrentRound();
    const question = getCurrentQuestion();
    const progress = getRevealProgress();
    const nextButton = $("next-round-btn");

    renderSetupSummary();
    $("winner-name").textContent = GameState.winner || "No Winner";
    $("correct-answer").textContent = question ? question.answer : "";
    $("end-round-id").textContent = round ? `${getRoundDisplayName(round)} · Q${GameState.currentQuestionIndex + 1}/${getQuestionCount(round)}` : "-";
    $("end-reveal-count").textContent = String(progress.revealed);
    nextButton.textContent = hasNextQuestionInRound() ? "Next Question" : "Back To Setup";
}

function importDeck(jsonText) {
    try {
        const rawDeck = JSON.parse(jsonText);
        const validation = validateDeck(rawDeck);

        if (!validation.valid) {
            UIState.importErrors = validation.errors;
            updateDeckStatus();
            renderRoundSelection();
            showToast("Deck validation failed. Review the listed issues.", "error");
            return false;
        }

        const normalizedDeck = normalizeDeck(rawDeck);
        UIState.importErrors = [];
        GameState.deck = normalizedDeck;
        GameState.wordCount = normalizedDeck.defaultWordCount;
        $("word-count").value = normalizedDeck.defaultWordCount;
        saveState();
        renderSettingsScreen();
        updateCustomWordCountHint();
        showToast(`Loaded ${normalizedDeck.title}.`, "success");
        return true;
    } catch (error) {
        UIState.importErrors = [{ roundId: null, reason: error.message }];
        updateDeckStatus();
        showToast("Deck JSON could not be parsed.", "error");
        return false;
    }
}

function exportDeck() {
    if (!GameState.deck) {
        showToast("There is no deck to export yet.", "warning");
        return;
    }

    const json = JSON.stringify(GameState.deck, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${GameState.deck.title.replace(/[^a-z0-9]/gi, "_")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast("Deck exported.", "success");
}

async function loadSampleDeck() {
    try {
        const response = await fetch("sample-deck.json");
        if (!response.ok) {
            throw new Error("Failed to load sample deck");
        }

        const json = await response.text();
        importDeck(json);
    } catch (error) {
        showToast(`Sample deck could not be loaded: ${error.message}`, "error");
    }
}

function initializeDeckIfNeeded() {
    if (!GameState.deck) {
        GameState.deck = {
            title: "Custom Deck",
            defaultWordCount: GameState.wordCount,
            rounds: []
        };
    } else if (GameState.deck.defaultWordCount !== GameState.wordCount) {
        GameState.deck.defaultWordCount = GameState.wordCount;
    }
}

function showCustomRoundStatus(message, tone) {
    const status = $("custom-round-status");
    setBanner(status, { message, tone, hidden: false });

    if (UIState.customStatusTimer) {
        clearTimeout(UIState.customStatusTimer);
    }

    UIState.customStatusTimer = window.setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
    }, 3200);
}

function setCustomAdvancedState(expanded) {
    UIState.customAdvancedOpen = expanded;
    $("custom-round-advanced-panel").hidden = !expanded;
    $("custom-round-advanced-toggle").setAttribute("aria-expanded", String(expanded));
    $("custom-round-advanced-toggle").textContent = `${expanded ? "▾" : "▸"} Advanced options`;
}

function updateSaveRoundState() {
    const saveButton = $("save-custom-round-btn");
    const saveHelp = $("save-round-help");
    const hasQuestions = UIState.draftQuestions.length > 0;
    saveButton.disabled = !hasQuestions;
    saveButton.title = hasQuestions ? "" : "Add at least one question to save.";
    saveHelp.textContent = hasQuestions
        ? "The draft is ready to save when the lineup looks right."
        : "Add at least one question to save.";
}

function generateQuestionId(seed = "question") {
    return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildQuestionFromEditor(roundName, existingQuestion = null) {
    const phrase = $("custom-round-phrase").value.trim();
    const answer = $("custom-round-answer").value.trim();
    const wordCountInput = $("custom-round-word-count").value.trim();
    const roundSlug = slugifyRoundName(roundName);

    if (!roundSlug) {
        showCustomRoundStatus("Enter the round name before adding questions.", "error");
        return null;
    }

    if (!phrase) {
        showCustomRoundStatus("Please enter a phrase.", "error");
        return null;
    }

    if (!answer) {
        showCustomRoundStatus("Please enter an answer.", "error");
        return null;
    }

    const explicitWordCount = wordCountInput ? Number.parseInt(wordCountInput, 10) : undefined;
    if (wordCountInput && (Number.isNaN(explicitWordCount) || explicitWordCount < 10 || explicitWordCount > 30)) {
        showCustomRoundStatus("Word count override must be between 10 and 30.", "error");
        return null;
    }

    const normalizedPhrase = normalizePhrase(phrase);
    const actualWordCount = normalizedPhrase.split(" ").filter(Boolean).length;
    const expectedWordCount = explicitWordCount || GameState.deck?.defaultWordCount || GameState.wordCount;

    if (actualWordCount !== expectedWordCount) {
        showCustomRoundStatus(`Phrase has ${actualWordCount} words, but this question expects ${expectedWordCount}.`, "error");
        return null;
    }

    return {
        id: existingQuestion?.id || generateQuestionId(roundSlug),
        ...(explicitWordCount ? { wordCount: explicitWordCount } : {}),
        phrase: normalizedPhrase,
        answer
    };
}

function addOrUpdateDraftQuestion() {
    const roundName = $("custom-round-id").value.trim();
    const existingQuestion = UIState.editingDraftQuestionIndex !== null
        ? UIState.draftQuestions[UIState.editingDraftQuestionIndex]
        : null;
    const question = buildQuestionFromEditor(roundName, existingQuestion);

    if (!question) {
        return false;
    }

    if (UIState.editingDraftQuestionIndex !== null) {
        UIState.draftQuestions[UIState.editingDraftQuestionIndex] = question;
        showCustomRoundStatus(`Question ${UIState.editingDraftQuestionIndex + 1} updated.`, "success");
    } else {
        UIState.draftQuestions.push(question);
        showCustomRoundStatus(`Question ${UIState.draftQuestions.length} added to the draft round.`, "success");
    }

    resetCustomQuestionEditor();
    renderDraftQuestionList();
    renderSetupStepper();
    return true;
}

function saveCustomRound() {
    const roundName = normalizeLabel($("custom-round-id").value);
    const generatedRoundId = getUniqueRoundId(roundName);

    if (!generatedRoundId) {
        showCustomRoundStatus("Please enter a round name before saving.", "error");
        return false;
    }

    if (UIState.draftQuestions.length === 0) {
        showCustomRoundStatus("Add at least one question before saving the round.", "error");
        return false;
    }

    initializeDeckIfNeeded();

    GameState.deck.rounds.push({
        id: generatedRoundId,
        displayName: roundName,
        questions: UIState.draftQuestions.map((question) => ({ ...question }))
    });
    const savedQuestionCount = GameState.deck.rounds[GameState.deck.rounds.length - 1].questions.length;

    UIState.importErrors = [];
    UIState.draftQuestions = [];
    UIState.editingDraftQuestionIndex = null;
    $("custom-round-id").value = "";
    resetCustomQuestionEditor();
    setCustomAdvancedState(false);

    saveState();
    renderSettingsScreen();
    showCustomRoundStatus(`Round "${roundName}" saved with ${savedQuestionCount} questions.`, "success");
    return true;
}

function updateCustomWordCountHint() {
    const phrase = $("custom-round-phrase").value.trim();
    const wordCountInput = $("custom-round-word-count").value.trim();
    const hint = $("custom-word-count-hint");

    if (!phrase) {
        hint.textContent = "";
        hint.className = "inline-status";
        return;
    }

    const actualWordCount = normalizePhrase(phrase).split(" ").filter(Boolean).length;
    let expectedWordCount;

    if (wordCountInput) {
        expectedWordCount = Number.parseInt(wordCountInput, 10);
        if (Number.isNaN(expectedWordCount) || expectedWordCount < 10 || expectedWordCount > 30) {
            hint.textContent = `${actualWordCount} / ? words`;
            hint.className = "inline-status invalid";
            return;
        }
    } else {
        expectedWordCount = GameState.deck?.defaultWordCount || GameState.wordCount;
    }

    if (actualWordCount === expectedWordCount) {
        hint.textContent = `${actualWordCount} / ${expectedWordCount} words`;
        hint.className = "inline-status valid";
    } else if (Math.abs(actualWordCount - expectedWordCount) === 1) {
        hint.textContent = `${actualWordCount} / ${expectedWordCount} words`;
        hint.className = "inline-status warning";
    } else {
        hint.textContent = `${actualWordCount} / ${expectedWordCount} words`;
        hint.className = "inline-status invalid";
    }
}

function setClearStateConfirmationVisible(visible) {
    UIState.clearStateConfirming = visible;
    $("clear-state-confirmation").hidden = !visible;
    $("clear-state-btn").hidden = visible;
}

function setResetRoundConfirmationVisible(visible) {
    UIState.resetRoundConfirming = visible;
    $("reset-round-confirmation").hidden = !visible;
    $("reset-round-btn").hidden = visible;
}

function wireStaticEventListeners() {
    $("theme-toggle-btn").addEventListener("click", () => {
        const nextTheme = document.body.classList.contains("theme-light") ? "dark" : "light";
        applyTheme(nextTheme);
        saveThemePreference(nextTheme);
    });

    $("add-team-btn").addEventListener("click", () => {
        GameState.teams.push(`Team ${GameState.teams.length + 1}`);
        saveState();
        renderSettingsScreen();
    });

    $("word-count").addEventListener("input", (event) => {
        const value = Number.parseInt(event.target.value, 10);
        if (value >= 10 && value <= 30) {
            GameState.wordCount = value;
            if (GameState.deck) {
                GameState.deck.defaultWordCount = value;
            }
            saveState();
            renderSetupSummary();
            renderRoundSelection();
            updateCustomWordCountHint();
        }
    });

    $("import-file-btn").addEventListener("click", () => {
        $("file-input").click();
    });

    $("file-input").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            importDeck(loadEvent.target.result);
        };
        reader.readAsText(file);
        event.target.value = "";
    });

    $("import-paste-btn").addEventListener("click", () => {
        $("import-paste-area").hidden = false;
        $("paste-textarea").focus();
    });

    $("paste-cancel-btn").addEventListener("click", () => {
        $("import-paste-area").hidden = true;
        $("paste-textarea").value = "";
    });

    $("paste-import-btn").addEventListener("click", () => {
        if (importDeck($("paste-textarea").value)) {
            $("import-paste-area").hidden = true;
            $("paste-textarea").value = "";
        }
    });

    $("export-deck-btn").addEventListener("click", exportDeck);
    $("load-sample-btn").addEventListener("click", loadSampleDeck);
    $("add-custom-round-btn").addEventListener("click", addOrUpdateDraftQuestion);
    $("save-custom-round-btn").addEventListener("click", saveCustomRound);
    $("reset-custom-question-btn").addEventListener("click", resetCustomQuestionEditor);
    $("custom-round-id").addEventListener("input", renderSetupStepper);
    $("custom-round-phrase").addEventListener("input", updateCustomWordCountHint);
    $("custom-round-phrase").addEventListener("input", renderSetupStepper);
    $("custom-round-answer").addEventListener("input", renderSetupStepper);
    $("custom-round-word-count").addEventListener("input", updateCustomWordCountHint);
    $("custom-round-word-count").addEventListener("input", () => {
        if ($("custom-round-word-count").value.trim()) {
            setCustomAdvancedState(true);
        }
    });
    $("custom-round-advanced-toggle").addEventListener("click", () => {
        setCustomAdvancedState(!UIState.customAdvancedOpen);
    });
    $("round-select").addEventListener("change", updateRoundPreview);

    $("start-selected-btn").addEventListener("click", () => {
        const roundId = $("round-select").value;
        if (roundId) {
            startRound(roundId, 0);
        }
    });

    $("start-random-btn").addEventListener("click", () => {
        if (!GameState.deck || GameState.deck.rounds.length === 0) {
            return;
        }

        const randomIndex = Math.floor(Math.random() * GameState.deck.rounds.length);
        startRound(GameState.deck.rounds[randomIndex].id, 0);
    });

    $("clear-state-btn").addEventListener("click", () => setClearStateConfirmationVisible(true));
    $("cancel-clear-state-btn").addEventListener("click", () => setClearStateConfirmationVisible(false));
    $("confirm-clear-state-btn").addEventListener("click", () => {
        clearState();
        setClearStateConfirmationVisible(false);
        showScreen("settings-screen");
        renderSettingsScreen();
        showToast("Saved state cleared.", "success");
    });

    $("back-to-settings-btn").addEventListener("click", () => {
        showScreen("settings-screen");
        renderSettingsScreen();
    });

    $("guess-input").addEventListener("keypress", (event) => {
        if (event.key === "Enter" && !$("submit-guess-btn").disabled) {
            $("submit-guess-btn").click();
        }
    });
    $("guess-input").addEventListener("input", updateGuessSubmitButtonState);

    $("submit-guess-btn").addEventListener("click", () => {
        submitGuess($("guess-input").value);
    });

    $("undo-btn").addEventListener("click", undoLastAction);

    $("reveal-all-btn").addEventListener("click", () => {
        openConfirmModal({
            title: "Reveal Every Tile",
            body: "This exposes the full board immediately and removes the clue-by-clue tension.",
            confirmLabel: "Reveal All",
            confirmClass: "btn-primary",
            onConfirm: revealAllTiles
        });
    });

    $("reset-round-btn").addEventListener("click", () => setResetRoundConfirmationVisible(true));
    $("cancel-reset-round-btn").addEventListener("click", () => setResetRoundConfirmationVisible(false));
    $("confirm-reset-round-btn").addEventListener("click", () => {
        setResetRoundConfirmationVisible(false);
        resetRound();
    });

    $("next-round-btn").addEventListener("click", () => {
        advanceToNextQuestionOrSetup();
    });

    $("replay-round-btn").addEventListener("click", () => {
        const roundId = GameState.currentRoundId;
        if (roundId) {
            startRound(roundId, GameState.currentQuestionIndex);
        }
    });

    $("feedback-modal-cancel").addEventListener("click", closeConfirmModal);
    $("feedback-modal-confirm").addEventListener("click", () => {
        const action = UIState.confirmAction;
        closeConfirmModal();
        if (action) {
            action();
        }
    });

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
        backdrop.addEventListener("click", (event) => {
            if (event.target.closest("#feedback-modal")) {
                closeConfirmModal();
            }
        });
    });

    setCustomAdvancedState(false);
    setClearStateConfirmationVisible(false);
    setResetRoundConfirmationVisible(false);
}

document.addEventListener("DOMContentLoaded", () => {
    applyTheme(loadThemePreference());
    const hasSavedState = loadState();
    wireStaticEventListeners();
    renderSettingsScreen();

    if (hasSavedState && GameState.currentRoundId && GameState.deck) {
        const currentQuestion = getCurrentQuestion();
        if (!currentQuestion) {
            showScreen("settings-screen");
            renderSettingsScreen();
            return;
        }

        if (GameState.winner) {
            showScreen("end-screen");
            renderEndScreen();
        } else {
            showScreen("game-screen");
            renderGameScreen();
        }
    }
});
