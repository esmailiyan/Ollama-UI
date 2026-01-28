// Application State
const state = {
    messages: [],
    currentModel: null,
    availableModels: [],
    defaultModel: null,
    websocket: null,
    isStreaming: false,
    systemPrompt: '',
    currentMessageId: null,
    thinkingContent: '',
    isThinkingCollapsed: false,
    thinkingStartTime: null,
    thinkingTimerInterval: null
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
    systemPromptPopup: document.getElementById('systemPromptPopup'),
    systemPromptText: document.getElementById('systemPromptText'),
    closeSystemPrompt: document.getElementById('closeSystemPrompt'),
    saveSystemPrompt: document.getElementById('saveSystemPrompt'),
    settingsBtn: document.getElementById('settingsBtn'),
    thinkingPanel: document.getElementById('thinkingPanel'),
    thinkingPanelHeader: document.getElementById('thinkingPanelHeader'),
    thinkingToggle: document.getElementById('thinkingToggle'),
    thinkingText: document.getElementById('thinkingText'),
    thinkingTimer: document.getElementById('thinkingTimer')
};

// Initialize Marked for Markdown rendering with better options
marked.setOptions({
    breaks: true,
    gfm: true,
    tables: true,
    pedantic: false,
    sanitize: false,
    smartLists: true,
    smartypants: true,
    headerIds: false,
    mangle: false,
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(code, { language: lang }).value;
            } catch (err) {
                return hljs.highlightAuto(code).value;
            }
        }
        return hljs.highlightAuto(code).value;
    }
});

// Configure KaTeX for math rendering with better options
const renderMath = (element = null) => {
    if (typeof renderMathInElement !== 'undefined') {
        const targetElement = element || elements.chatMessages;
        renderMathInElement(targetElement, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\[', right: '\\]', display: true},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\begin{equation}', right: '\\end{equation}', display: true},
                {left: '\\begin{align}', right: '\\end{align}', display: true},
                {left: '\\begin{alignat}', right: '\\end{alignat}', display: true},
                {left: '\\begin{gather}', right: '\\end{gather}', display: true},
                {left: '\\begin{CD}', right: '\\end{CD}', display: true}
            ],
            throwOnError: false,
            errorColor: '#cc0000',
            strict: false,
            trust: true
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
            state.thinkingContent = '';
            // Start thinking panel with timer
            showThinkingPanel();
            break;
        case 'thinking_chunk':
            appendThinkingContent(data.content);
            break;
        case 'chunk':
            appendToLastMessage(data.content);
            // Math rendering is handled in appendToLastMessage
            break;
        case 'done':
            hideThinkingIndicator();
            state.isStreaming = false;
            updateUI();
            // Final math render
            renderMath();
            // Hide thinking panel if empty
            if (!state.thinkingContent.trim()) {
                hideThinkingPanel();
            }
            break;
        case 'cancelled':
            hideThinkingIndicator();
            hideThinkingPanel();
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
            hideThinkingPanel();
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
        // Parse markdown with better options
        const parsed = marked.parse(content);
        contentEl.innerHTML = parsed;
        
        // Highlight code blocks
        contentEl.querySelectorAll('pre code').forEach((block) => {
            // Only highlight if not already highlighted
            if (!block.classList.contains('hljs')) {
                hljs.highlightElement(block);
            }
        });
        
        // Render math after DOM is ready
        requestAnimationFrame(() => {
            try {
                renderMath(contentEl);
            } catch (e) {
                console.warn('Math rendering error:', e);
            }
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
            // Use a temporary div to avoid flickering
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = marked.parse(lastMessage.content);
            
            // Highlight code blocks before inserting
            tempDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            
            // Replace content
            contentEl.innerHTML = tempDiv.innerHTML;
            
            // Render math after content is updated
            // Use requestAnimationFrame for better performance
            requestAnimationFrame(() => {
                try {
                    renderMath(contentEl);
                } catch (e) {
                    console.warn('Math rendering error:', e);
                }
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

// Show thinking panel
function showThinkingPanel() {
    if (elements.thinkingPanel) {
        elements.thinkingPanel.style.display = 'block';
        state.thinkingContent = '';
        elements.thinkingText.textContent = '';
        state.thinkingStartTime = Date.now();
        
        // Start timer
        if (state.thinkingTimerInterval) {
            clearInterval(state.thinkingTimerInterval);
        }
        state.thinkingTimerInterval = setInterval(() => {
            if (state.thinkingStartTime && elements.thinkingTimer) {
                const elapsed = Math.floor((Date.now() - state.thinkingStartTime) / 1000);
                elements.thinkingTimer.textContent = elapsed;
            }
        }, 1000);
        
        // Auto-expand if collapsed
        if (state.isThinkingCollapsed) {
            toggleThinkingPanel();
        }
        scrollToBottom();
    }
}

// Check if thinking panel should be shown
function checkThinkingPanel() {
    if (elements.thinkingPanel && state.thinkingContent.trim()) {
        elements.thinkingPanel.style.display = 'block';
    } else if (elements.thinkingPanel && !state.thinkingContent.trim()) {
        elements.thinkingPanel.style.display = 'none';
    }
}

// Hide thinking panel
function hideThinkingPanel() {
    // Stop timer
    if (state.thinkingTimerInterval) {
        clearInterval(state.thinkingTimerInterval);
        state.thinkingTimerInterval = null;
    }
    state.thinkingStartTime = null;
    
    if (elements.thinkingPanel) {
        // Don't hide immediately, keep it visible so user can see the final thinking
        // Only hide if no content after streaming is done
        if (!state.thinkingContent.trim() && !state.isStreaming) {
            elements.thinkingPanel.style.display = 'none';
        }
    }
}

// Append thinking content
function appendThinkingContent(content) {
    if (elements.thinkingText && content) {
        state.thinkingContent += content;
        // Parse markdown for thinking content
        const parsed = marked.parse(state.thinkingContent);
        elements.thinkingText.innerHTML = parsed;
        
        // Highlight code blocks if any
        elements.thinkingText.querySelectorAll('pre code').forEach((block) => {
            if (!block.classList.contains('hljs')) {
                hljs.highlightElement(block);
            }
        });
        
        checkThinkingPanel();
        // Auto-scroll thinking panel if expanded
        if (!state.isThinkingCollapsed && elements.thinkingPanel) {
            const contentEl = elements.thinkingPanel.querySelector('.thinking-panel-content');
            if (contentEl) {
                contentEl.scrollTop = contentEl.scrollHeight;
            }
        }
    }
}

// Toggle thinking panel
function toggleThinkingPanel() {
    if (elements.thinkingPanel) {
        state.isThinkingCollapsed = !state.isThinkingCollapsed;
        if (state.isThinkingCollapsed) {
            elements.thinkingPanel.classList.add('collapsed');
        } else {
            elements.thinkingPanel.classList.remove('collapsed');
        }
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
    state.thinkingContent = '';
    // Stop thinking timer if running
    if (state.thinkingTimerInterval) {
        clearInterval(state.thinkingTimerInterval);
        state.thinkingTimerInterval = null;
    }
    state.thinkingStartTime = null;
    hideThinkingPanel();
    const currentModelName = elements.welcomeModelName ? elements.welcomeModelName.textContent : 'در حال بارگذاری...';
    elements.chatMessages.innerHTML = `
        <div class="welcome-message">
            <h1 id="welcomeModelName">${currentModelName}</h1>
            <p>چطور می‌تونم کمکتون کنم؟</p>
        </div>
    `;
    elements.welcomeModelName = document.getElementById('welcomeModelName');
});

// Settings button opens system prompt popup
elements.settingsBtn.addEventListener('click', () => {
    elements.systemPromptText.value = state.systemPrompt;
    elements.systemPromptPopup.style.display = 'flex';
});

// Close popup
elements.closeSystemPrompt.addEventListener('click', () => {
    elements.systemPromptPopup.style.display = 'none';
});

// Save system prompt
elements.saveSystemPrompt.addEventListener('click', () => {
    state.systemPrompt = elements.systemPromptText.value.trim();
    elements.systemPromptPopup.style.display = 'none';
});

// Close popup when clicking outside
elements.systemPromptPopup.addEventListener('click', (e) => {
    if (e.target === elements.systemPromptPopup) {
        elements.systemPromptPopup.style.display = 'none';
    }
});

// Update system prompt on input
elements.systemPromptText.addEventListener('input', () => {
    state.systemPrompt = elements.systemPromptText.value.trim();
});

// Thinking panel toggle
if (elements.thinkingPanelHeader) {
    elements.thinkingPanelHeader.addEventListener('click', (e) => {
        // Don't toggle if clicking on the toggle button itself (it has its own handler)
        if (e.target !== elements.thinkingToggle && !elements.thinkingToggle.contains(e.target)) {
            toggleThinkingPanel();
        }
    });
}

if (elements.thinkingToggle) {
    elements.thinkingToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleThinkingPanel();
    });
}

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
