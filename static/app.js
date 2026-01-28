// Application State
const state = {
    messages: [],
    currentModel: null,
    availableModels: [],
    defaultModel: null,
    websocket: null,
    isStreaming: false,
    systemPrompt: '',
    currentMessageId: null
};

// DOM Elements
const elements = {
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    modelSelect: document.getElementById('modelSelect'),
    welcomeModelName: document.getElementById('welcomeModelName'),
    newChatBtn: document.getElementById('newChatBtn'),
    systemPromptToggle: document.getElementById('systemPromptToggle'),
    systemPromptInput: document.getElementById('systemPromptInput'),
    systemPromptText: document.getElementById('systemPromptText'),
    closeSystemPrompt: document.getElementById('closeSystemPrompt'),
    settingsBtn: document.getElementById('settingsBtn')
};

// Initialize Marked for Markdown rendering
marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(code, { language: lang }).value;
            } catch (err) {}
        }
        return hljs.highlightAuto(code).value;
    }
});

// Configure KaTeX for math rendering
const renderMath = () => {
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(elements.chatMessages, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\[', right: '\\]', display: true},
                {left: '\\(', right: '\\)', display: false}
            ],
            throwOnError: false
        });
    }
};

// Load models from API
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        state.availableModels = data.models;
        state.defaultModel = data.default || (data.models[0]?.id);

        // Populate model select
        elements.modelSelect.innerHTML = '';
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            if (model.id === state.defaultModel) {
                option.selected = true;
                state.currentModel = model.id;
            }
            elements.modelSelect.appendChild(option);
        });

        // Update welcome message
        const selectedModel = data.models.find(m => m.id === state.currentModel);
        if (selectedModel) {
            elements.welcomeModelName.textContent = selectedModel.name;
        }
    } catch (error) {
        console.error('Error loading models:', error);
        elements.modelSelect.innerHTML = '<option value="">خطا در بارگذاری مدل‌ها</option>';
    }
}

// Initialize WebSocket connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    
    state.websocket = new WebSocket(wsUrl);

    state.websocket.onopen = () => {
        console.log('WebSocket connected');
    };

    state.websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    state.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        addSystemMessage('خطا در اتصال به سرور');
    };

    state.websocket.onclose = () => {
        console.log('WebSocket disconnected');
        // Try to reconnect after 3 seconds
        setTimeout(initWebSocket, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'thinking':
            showThinkingIndicator();
            break;
        case 'chunk':
            appendToLastMessage(data.content);
            break;
        case 'done':
            hideThinkingIndicator();
            state.isStreaming = false;
            updateUI();
            renderMath();
            break;
        case 'cancelled':
            hideThinkingIndicator();
            state.isStreaming = false;
            updateUI();
            if (state.currentMessageId) {
                const messageEl = document.getElementById(state.currentMessageId);
                if (messageEl) {
                    const contentEl = messageEl.querySelector('.message-content');
                    if (contentEl && !contentEl.textContent.trim()) {
                        contentEl.textContent = 'پاسخ متوقف شد';
                    }
                }
            }
            break;
        case 'error':
            hideThinkingIndicator();
            state.isStreaming = false;
            updateUI();
            addSystemMessage(data.content);
            break;
    }
}

// Add message to chat
function addMessage(role, content, messageId = null) {
    const message = {
        id: messageId || `msg-${Date.now()}-${Math.random()}`,
        role,
        content
    };
    state.messages.push(message);

    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.id = message.id;

    const headerEl = document.createElement('div');
    headerEl.className = 'message-header';

    const avatarEl = document.createElement('div');
    avatarEl.className = `message-avatar ${role}`;
    avatarEl.textContent = role === 'user' ? 'U' : 'AI';

    const roleEl = document.createElement('span');
    roleEl.className = 'message-role';
    roleEl.textContent = role === 'user' ? 'کاربر' : 'دستیار';

    headerEl.appendChild(avatarEl);
    headerEl.appendChild(roleEl);

    const contentEl = document.createElement('div');
    contentEl.className = `message-content ${role}`;
    
    if (role === 'user') {
        contentEl.textContent = content;
    } else {
        contentEl.innerHTML = marked.parse(content);
        // Highlight code blocks
        contentEl.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    // Remove welcome message if exists
    const welcomeMsg = elements.chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    elements.chatMessages.appendChild(messageEl);
    scrollToBottom();

    return messageEl;
}

// Append content to last AI message (for streaming)
function appendToLastMessage(content) {
    let lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage('assistant', '');
        lastMessage = state.messages[state.messages.length - 1];
    }

    lastMessage.content += content;
    state.currentMessageId = lastMessage.id;

    const messageEl = document.getElementById(lastMessage.id);
    if (messageEl) {
        const contentEl = messageEl.querySelector('.message-content');
        if (contentEl) {
            // Re-render markdown with new content
            contentEl.innerHTML = marked.parse(lastMessage.content);
            // Highlight code blocks
            contentEl.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            scrollToBottom();
        }
    }
}

// Show thinking indicator
function showThinkingIndicator() {
    let indicator = document.getElementById('thinking-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'thinking-indicator';
        indicator.className = 'thinking-indicator';
        indicator.innerHTML = `
            <div class="spinner"></div>
            <span>در حال پردازش...</span>
        `;
        elements.chatMessages.appendChild(indicator);
    }
    scrollToBottom();
}

// Hide thinking indicator
function hideThinkingIndicator() {
    const indicator = document.getElementById('thinking-indicator');
    if (indicator) {
        indicator.remove();
    }
}

// Add system message
function addSystemMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.style.opacity = '0.7';
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content ai';
    contentEl.textContent = text;
    
    messageEl.appendChild(contentEl);
    elements.chatMessages.appendChild(messageEl);
    scrollToBottom();
}

// Send message
async function sendMessage() {
    const inputText = elements.chatInput.textContent.trim();
    if (!inputText || state.isStreaming) return;

    if (!state.currentModel) {
        addSystemMessage('لطفاً یک مدل انتخاب کنید');
        return;
    }

    // Add user message
    addMessage('user', inputText);

    // Clear input
    elements.chatInput.textContent = '';
    elements.chatInput.style.height = 'auto';

    // Prepare messages for API
    const messages = state.messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
            role: msg.role,
            content: msg.content
        }));

    // Send via WebSocket
    state.isStreaming = true;
    updateUI();

    state.websocket.send(JSON.stringify({
        model: state.currentModel,
        messages: messages,
        system_prompt: state.systemPrompt
    }));
}

// Stop streaming
function stopStreaming() {
    if (state.websocket && state.isStreaming) {
        state.websocket.send(JSON.stringify({
            type: 'cancel'
        }));
    }
}

// Update UI based on state
function updateUI() {
    if (state.isStreaming) {
        elements.sendBtn.style.display = 'none';
        elements.stopBtn.style.display = 'flex';
        elements.chatInput.contentEditable = 'false';
    } else {
        elements.sendBtn.style.display = 'flex';
        elements.stopBtn.style.display = 'none';
        elements.chatInput.contentEditable = 'true';
    }
}

// Scroll to bottom
function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Event Listeners
elements.sendBtn.addEventListener('click', sendMessage);
elements.stopBtn.addEventListener('click', stopStreaming);

elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

elements.chatInput.addEventListener('input', () => {
    // Auto-resize input
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = elements.chatInput.scrollHeight + 'px';
});

elements.modelSelect.addEventListener('change', (e) => {
    state.currentModel = e.target.value;
    const selectedModel = state.availableModels.find(m => m.id === state.currentModel);
    if (selectedModel) {
        elements.welcomeModelName.textContent = selectedModel.name;
    }
});

elements.newChatBtn.addEventListener('click', () => {
    state.messages = [];
    state.currentMessageId = null;
    elements.chatMessages.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-logo">OI</div>
            <h1 id="welcomeModelName">${elements.welcomeModelName.textContent}</h1>
            <p>چطور می‌تونم کمکتون کنم؟</p>
        </div>
    `;
    elements.welcomeModelName = document.getElementById('welcomeModelName');
});

elements.systemPromptToggle.addEventListener('click', () => {
    if (elements.systemPromptInput.style.display === 'none') {
        elements.systemPromptInput.style.display = 'block';
        elements.systemPromptText.value = state.systemPrompt;
    } else {
        elements.systemPromptInput.style.display = 'none';
    }
});

elements.closeSystemPrompt.addEventListener('click', () => {
    elements.systemPromptInput.style.display = 'none';
    state.systemPrompt = elements.systemPromptText.value.trim();
});

elements.systemPromptText.addEventListener('input', () => {
    state.systemPrompt = elements.systemPromptText.value.trim();
});

// Initialize app
async function init() {
    await loadModels();
    initWebSocket();
    updateUI();
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
