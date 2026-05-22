// ============================================
// 1. js/core/store.js - 상태 관리
// ============================================

class Store {
  constructor() {
    this.state = {
      auth: {
        token: null,
        user: null,
        expiresAt: null
      },
      data: {
        clients: [],
        memos: [],
        contacts: [],
        agents: [],
        smsHistory: []
      },
      ui: {
        currentTab: 'dashboard',
        activeModal: null,
        isLoading: false
      },
      settings: {
        isDemo: false,
        language: 'ko'
      }
    };
    this.listeners = [];
    this.load();
  }
  
  setState(path, value) {
    const keys = path.split('.');
    let target = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    this.save();
    this.notifyListeners();
  }
  
  getState(path) {
    const keys = path.split('.');
    let target = this.state;
    for (const key of keys) {
      target = target[key];
    }
    return target;
  }
  
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  notifyListeners() {
    this.listeners.forEach(fn => fn(this.state));
  }
  
  save() {
    try {
      localStorage.setItem('fincrm_state', JSON.stringify(this.state));
    } catch (e) {
      console.error('Storage save failed:', e);
    }
  }
  
  load() {
    try {
      const saved = localStorage.getItem('fincrm_state');
      if (saved) {
        this.state = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Storage load failed:', e);
    }
  }
  
  clear() {
    localStorage.removeItem('fincrm_state');
    this.state = this.getInitialState();
  }
}

// 사용 예
const store = new Store();

// 클라이언트 추가
store.setState('data.clients', [
  ...store.getState('data.clients'),
  newClient
]);

// UI 상태 변경
store.setState('ui.currentTab', 'clients');

// 구독
store.subscribe((newState) => {
  renderUI(newState);
});


// ============================================
// 2. js/core/api.js - API 통일 관리
// ============================================

class APIClient {
  constructor(token, config = {}) {
    this.token = token;
    this.baseURL = config.baseURL || '';
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }
  
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
      ...options.headers
    };
    
    let lastError;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: AbortSignal.timeout(this.timeout)
        });
        
        if (!response.ok) {
          throw new APIError(
            `HTTP ${response.status}`,
            response.status,
            response.statusText
          );
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
        
      } catch (error) {
        lastError = error;
        if (attempt < this.retries && error.code !== 401) {
          await this.delay(Math.pow(2, attempt - 1) * 1000);
          continue;
        }
        break;
      }
    }
    
    throw lastError;
  }
  
  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }
  
  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  
  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
  
  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class APIError extends Error {
  constructor(message, code, statusText) {
    super(message);
    this.code = code;
    this.statusText = statusText;
  }
}

// Google API 전문 클래스
class GoogleSheetsAPI extends APIClient {
  constructor(token, spreadsheetId) {
    super(token, {
      baseURL: 'https://sheets.googleapis.com/v4'
    });
    this.spreadsheetId = spreadsheetId;
  }
  
  async readRange(range) {
    const url = `/spreadsheets/${this.spreadsheetId}/values/${range}`;
    return this.get(url);
  }
  
  async writeRange(range, values) {
    const url = `/spreadsheets/${this.spreadsheetId}/values/${range}`;
    return this.put(url, { values });
  }
  
  async appendRow(range, values) {
    const url = `/spreadsheets/${this.spreadsheetId}/values/${range}:append`;
    return this.post(url, { values: [values] });
  }
}

class GoogleDriveAPI extends APIClient {
  constructor(token) {
    super(token, {
      baseURL: 'https://www.googleapis.com/drive/v3'
    });
  }
  
  async listFiles(query, pageSize = 10) {
    return this.get('/files', {
      params: {
        q: query,
        pageSize,
        fields: 'files(id,name,webViewLink,createdTime)'
      }
    });
  }
  
  async uploadFile(file, parentId) {
    const formData = new FormData();
    const metadata = {
      name: file.name,
      parents: [parentId]
    };
    
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', file);
    
    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData
    }).then(r => r.json());
  }
  
  async deleteFile(fileId) {
    return this.delete(`/files/${fileId}`);
  }
}

// 사용 예
const sheetsApi = new GoogleSheetsAPI(token, SPREADSHEET_ID);
const driveApi = new GoogleDriveAPI(token);

try {
  const data = await sheetsApi.readRange('A1:D100');
  console.log(data);
} catch (error) {
  if (error.code === 401) {
    // 토큰 만료 처리
  }
}


// ============================================
// 3. js/utils/date.js - 날짜 유틸 통합
// ============================================

const DateUtils = {
  // 입력 형식: DD/MM/YYYY
  parse(dateStr) {
    if (!dateStr) return null;
    
    const s = String(dateStr).trim();
    
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [dd, mm, yyyy] = s.split('/').map(Number);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
        return new Date(yyyy, mm - 1, dd);
      }
    }
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(s);
    }
    
    return null;
  },
  
  format(date, format = 'DD/MM/YYYY') {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    return format
      .replace('DD', day)
      .replace('MM', month)
      .replace('YYYY', year);
  },
  
  getAge(dateStr) {
    const birth = this.parse(dateStr);
    if (!birth) return null;
    
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  },
  
  getDaysUntilBirthday(dateStr) {
    const birth = this.parse(dateStr);
    if (!birth) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let nextBday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
    if (nextBday < today) {
      nextBday.setFullYear(today.getFullYear() + 1);
    }
    
    return Math.ceil((nextBday - today) / 86400000);
  },
  
  isBirthdayToday(dateStr) {
    return this.getDaysUntilBirthday(dateStr) === 0;
  }
};

// 사용
const age = DateUtils.getAge('15/03/1980');
const days = DateUtils.getDaysUntilBirthday('15/03/1980');


// ============================================
// 4. js/modules/clients.js - 클라이언트 기능
// ============================================

class ClientManager {
  constructor(store, api) {
    this.store = store;
    this.api = api;
  }
  
  async addClient(clientData) {
    // 검증
    if (!this.validateClient(clientData)) {
      throw new Error('Invalid client data');
    }
    
    const client = {
      ...clientData,
      id: Date.now(),
      createdAt: new Date().toISOString()
    };
    
    const clients = this.store.getState('data.clients');
    this.store.setState('data.clients', [...clients, client]);
    
    return client;
  }
  
  async updateClient(id, updates) {
    const clients = this.store.getState('data.clients');
    const idx = clients.findIndex(c => c.id === id);
    
    if (idx === -1) throw new Error('Client not found');
    
    const updated = { ...clients[idx], ...updates };
    if (!this.validateClient(updated)) {
      throw new Error('Invalid client data');
    }
    
    clients[idx] = updated;
    this.store.setState('data.clients', [...clients]);
    
    return updated;
  }
  
  async deleteClient(id) {
    const clients = this.store.getState('data.clients');
    const filtered = clients.filter(c => c.id !== id);
    this.store.setState('data.clients', filtered);
  }
  
  async getClient(id) {
    const clients = this.store.getState('data.clients');
    return clients.find(c => c.id === id);
  }
  
  async searchClients(query) {
    const clients = this.store.getState('data.clients');
    const q = query.toLowerCase();
    
    return clients.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }
  
  validateClient(client) {
    // 검증 로직
    if (!client.fname || !client.lname) return false;
    if (client.email && !this.isValidEmail(client.email)) return false;
    return true;
  }
  
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

// 사용
const clientMgr = new ClientManager(store, api);
await clientMgr.addClient({
  fname: 'John',
  lname: 'Doe',
  email: 'john@example.com',
  phone: '555-1234',
  dob: '15/03/1980'
});


// ============================================
// 5. js/ui/table.js - 테이블 렌더링
// ============================================

class DataTable {
  constructor(selector, options = {}) {
    this.container = document.querySelector(selector);
    this.columns = options.columns || [];
    this.data = options.data || [];
    this.onRowClick = options.onRowClick || null;
    this.pageSize = options.pageSize || 50;
    this.currentPage = 0;
  }
  
  setData(data) {
    this.data = data;
    this.currentPage = 0;
    this.render();
  }
  
  render() {
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;
    const pageData = this.data.slice(start, end);
    
    const html = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              ${this.columns.map(col => `<th>${col.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${pageData.map((row, idx) => `
              <tr data-idx="${start + idx}" class="clickable">
                ${this.columns.map(col => {
                  const value = col.render
                    ? col.render(row)
                    : row[col.key] || '';
                  return `<td>${value}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        ${this.currentPage > 0 ? `<button onclick="table.prevPage()">←</button>` : ''}
        <span>${this.currentPage + 1} / ${Math.ceil(this.data.length / this.pageSize)}</span>
        ${this.currentPage < Math.ceil(this.data.length / this.pageSize) - 1 ? `<button onclick="table.nextPage()">→</button>` : ''}
      </div>
    `;
    
    this.container.innerHTML = html;
    
    // 클릭 이벤트
    if (this.onRowClick) {
      this.container.querySelectorAll('tbody tr.clickable').forEach(tr => {
        tr.addEventListener('click', () => {
          const idx = parseInt(tr.dataset.idx);
          this.onRowClick(this.data[idx]);
        });
      });
    }
  }
  
  nextPage() {
    if (this.currentPage < Math.ceil(this.data.length / this.pageSize) - 1) {
      this.currentPage++;
      this.render();
    }
  }
  
  prevPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.render();
    }
  }
}

// 사용
const clientTable = new DataTable('#clientList', {
  columns: [
    { key: 'no', label: 'No.' },
    { key: 'name', label: '이름' },
    { key: 'phone', label: '전화번호' },
    { 
      key: 'dob', 
      label: '생일',
      render: (row) => DateUtils.format(row.dob)
    }
  ],
  onRowClick: (row) => {
    console.log('Selected:', row);
  }
});

store.subscribe((newState) => {
  clientTable.setData(newState.data.clients);
});


// ============================================
// 6. js/main.js - 진입점
// ============================================

(async function() {
  // 1. 초기화
  const store = new Store();
  const api = new APIClient(store.getState('auth.token'));
  
  // 2. 매니저 생성
  const clientMgr = new ClientManager(store, api);
  
  // 3. UI 바인딩
  const clientTable = new DataTable('#clientList', {
    columns: [/* ... */],
    onRowClick: (client) => openEditModal(client)
  });
  
  // 4. 상태 구독
  store.subscribe((newState) => {
    clientTable.setData(newState.data.clients);
  });
  
  // 5. 로드
  try {
    const clients = await api.get('/clients');
    store.setState('data.clients', clients);
  } catch (error) {
    console.error('Failed to load clients:', error);
  }
})();

