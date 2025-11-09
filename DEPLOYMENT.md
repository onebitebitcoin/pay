# Deployment Guide

## Production Build

### Frontend

프로덕션 빌드 시 console.log, console.info, console.debug는 자동으로 제거됩니다. console.error와 console.warn은 유지됩니다.

```bash
cd frontend
npm run build
```

빌드된 파일은 `frontend/build` 디렉토리에 생성됩니다.

### Backend

프로덕션 환경에서 실행 시 `NODE_ENV=production`을 설정하면 console.log, console.info, console.debug가 비활성화됩니다.

```bash
cd backend
NODE_ENV=production npm start
```

또는 `.env` 파일에서 설정:

```
NODE_ENV=production
PORT=5001
DB_MODE=sqlite
```

## Environment Variables

### Backend (.env)

- `NODE_ENV`: 환경 설정 (development | production)
- `PORT`: 서버 포트 (기본값: 5001)
- `DB_MODE`: 데이터베이스 모드 (sqlite | json)

### Frontend

프론트엔드는 빌드 시 `NODE_ENV`가 자동으로 `production`으로 설정됩니다.

## Console Logging

### 개발 환경
- 모든 console 메시지 출력됨 (log, info, debug, warn, error)

### 프로덕션 환경
- Frontend: console.log, console.info, console.debug 제거 (빌드 시)
- Backend: console.log, console.info, console.debug 비활성화
- console.error와 console.warn은 유지됨 (디버깅용)

## 배포 체크리스트

- [ ] Frontend: `npm run build` 실행
- [ ] Backend: `.env` 파일에 `NODE_ENV=production` 설정
- [ ] 환경 변수 확인
- [ ] 데이터베이스 백업 (stores.db 또는 stores.json)
- [ ] SSL/HTTPS 설정 (프로덕션 환경)
