# Bitcoin Store Locator

A modern, responsive web application that helps users find Bitcoin-accepting stores using Kakao Maps integration. Built with React frontend and Node.js backend.

## Features

- Interactive Kakao Maps integration (무료)
- Search stores by name, category, or location
- Random store discovery
- Responsive design for all devices
- Real-time store filtering
- Custom Bitcoin markers on map
- Modern, clean UI design
- Korean-optimized with Kakao Maps

## Quick Start

1. **Clone and navigate to the project:**
   ```bash
   cd bitcoin-store
   ```

2. **Run the application:**
   ```bash
   ./run.sh
   ```

3. **Set up Kakao Maps API (무료):**
   - [카카오 개발자센터](https://developers.kakao.com/)에서 앱 생성
   - 웹 플랫폼 등록 (http://localhost:3000)
   - `frontend/public/index.html`에서 `YOUR_KAKAO_APP_KEY`를 실제 앱 키로 교체

4. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5001

## Manual Setup

If you prefer to run the services manually:

### Backend
```bash
cd backend
npm install
npm start
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## API Endpoints

- `GET /api/stores` - Get all stores
- `GET /api/stores/random?count=8` - Get random stores
- `GET /api/stores/search?q=query` - Search stores
- `GET /api/stores/:id` - Get specific store
- `GET /health` - Health check

### Cashu Mint (Lightning via Mint)
- `GET /api/cashu/info` - Mint info
- `GET /api/cashu/keys` - Mint public keys
- `POST /api/cashu/mint/quote` - Request LN invoice to mint eCash
  - body: `{ amount: number }`
  - returns: `{ quote, request }` (request is bolt11)
- `POST /api/cashu/mint/redeem` - After payment, redeem minted proofs
  - body: `{ quote, outputs: [] }` (outputs are blinded outputs created client-side)
  - returns: `{ signatures: [] }` (aka promises) which the client unblinds into proofs
- `POST /api/cashu/melt/quote` - Quote to pay a bolt11 using eCash
  - body: `{ invoice }` (server maps to `{ request }` for the mint) → returns `{ quote, amount, fee_reserve }`
- `POST /api/cashu/melt` - Pay bolt11 with provided proofs
  - body: `{ proofs: [], quote }` → returns `{ paid: boolean, change?: [] }`

Config:
- Backend `.env` → `CASHU_MINT_URL` (default: https://mint.minibits.cash/Bitcoin)

## Cashu Integration Notes
- The wallet stores eCash proofs locally in `localStorage` and sums their `amount` for display.
- “받기” creates a mint invoice; after paying from another wallet, press “결제 확인” to redeem proofs.
- “보내기” pastes a bolt11; the app selects proofs and melts them; change proofs (if any) are stored back.

## Project Structure

```
bitcoin-store/
├── frontend/          # React application
│   ├── src/
│   │   ├── App.js    # Main component
│   │   ├── App.css   # Styles
│   │   └── index.js  # Entry point
│   └── package.json
├── backend/           # Express API server
│   ├── server.js     # Main server file
│   └── package.json
├── run.sh            # Startup script
└── README.md
```

## Technologies Used

### Frontend
- React 18
- Kakao Maps API (무료)
- Modern CSS with Flexbox/Grid
- Responsive design
- Korean UI support

### Backend
- Node.js
- Express.js
- CORS enabled
- Helmet for security
- Sample Bitcoin store data

## Customization

- **Add more stores:** Edit the `bitcoinStores` array in `backend/server.js`
- **Change marker design:** Modify the SVG in `updateMapMarkers` function
- **Update UI colors:** Edit CSS variables in `frontend/src/App.css`
- **Add new API endpoints:** Extend `backend/server.js`

## Kakao Maps API 설정

1. [카카오 개발자센터](https://developers.kakao.com/) 접속
2. "내 애플리케이션" > "애플리케이션 추가하기"
3. 앱 이름 설정 후 생성
4. "플랫폼" 설정에서 "Web" 추가
5. 사이트 도메인에 `http://localhost:3000` 추가
6. 앱 키 복사하여 `frontend/public/index.html`에 적용

## Contributing

Feel free to submit issues and enhancement requests!
