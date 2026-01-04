#!/bin/bash

echo "비트코인 매장 찾기 서비스를 시작합니다..."
echo "=================================="

cleanup() {
    echo ""
    echo "서비스를 종료하는 중..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT

check_node() {
    if ! command -v node &> /dev/null; then
        echo "Node.js가 설치되지 않았습니다. Node.js를 먼저 설치해주세요."
        exit 1
    fi
    echo "Node.js 발견: $(node --version)"
}

check_npm() {
    if ! command -v npm &> /dev/null; then
        echo "npm이 설치되지 않았습니다. npm을 먼저 설치해주세요."
        exit 1
    fi
    echo "npm 발견: $(npm --version)"
}

kill_existing_processes() {
    echo "포트 3000과 5001에서 실행 중인 프로세스를 확인하는 중..."
    
    # Kill process on port 5001 (backend)
    if lsof -ti:5001 >/dev/null 2>&1; then
        echo "포트 5001의 기존 프로세스를 종료하는 중..."
        lsof -ti:5001 | xargs kill -9 2>/dev/null || true
    fi
    
    # Kill process on port 3000 (frontend)  
    if lsof -ti:3000 >/dev/null 2>&1; then
        echo "포트 3000의 기존 프로세스를 종료하는 중..."
        lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    fi
    
    # Wait a moment for ports to be released
    sleep 2
    echo "포트 정리 완료"
}

install_dependencies() {
    echo ""
    echo "의존성을 설치하는 중..."
    
    echo "백엔드 의존성 설치 중..."
    cd backend
    npm install
    cd ..
    
    echo "프론트엔드 의존성 설치 중..."
    cd frontend
    npm install
    cd ..
    
    echo "의존성 설치 완료!"
}

start_services() {
    echo ""
    echo "서비스를 시작하는 중..."

    echo "백엔드 서버 시작 중..."
    cd backend
    # Redirect backend logs to backend.log
    HOST=127.0.0.1 PORT=5001 npm start >> backend.log 2>&1 &
    BACKEND_PID=$!
    echo "백엔드 로그: backend/backend.log"
    cd ..

    sleep 3

    echo "프론트엔드 개발 서버 시작 중..."
    cd frontend
    HOST=127.0.0.1 PORT=3000 npm start &
    FRONTEND_PID=$!
    cd ..
    
    echo ""
    echo "서비스가 성공적으로 시작되었습니다!"
    echo "=================================="
    echo "백엔드 API: http://localhost:5001"
    echo "프론트엔드: http://localhost:3000"
    echo "=================================="
    echo ""
    echo "중요한 설정 단계:"
    echo "1. 카카오맵 API 키 발급: https://developers.kakao.com/"
    echo "2. 앱 생성 후 웹 플랫폼 등록"
    echo "3. frontend/public/index.html에서 'YOUR_KAKAO_APP_KEY' 교체"
    echo ""
    echo "Ctrl+C를 눌러 모든 서비스 종료"
    echo ""
    
    wait
}

main() {
    echo "사전 요구사항을 확인하는 중..."
    check_node
    check_npm
    
    kill_existing_processes
    
    if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
        install_dependencies
    else
        echo "의존성이 이미 설치되어 있습니다"
    fi
    
    start_services
}

main
