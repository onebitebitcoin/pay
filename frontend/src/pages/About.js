import React, { useState } from 'react';
import './Home.css';
import Icon from '../components/Icon';

function About() {
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      category: 'Cashu & eCash 기본',
      items: [
        {
          q: 'Cashu란 무엇인가요?',
          a: 'Cashu는 비트코인 라이트닝 네트워크를 기반으로 한 eCash 프로토콜입니다. Mint 서버가 발행하는 암호화된 토큰(eCash)을 사용하여 프라이버시를 보호하면서 빠르고 저렴한 결제가 가능합니다. Chaumian ecash 방식을 채택하여 Mint조차도 누가 어떤 토큰을 사용하는지 알 수 없습니다.'
        },
        {
          q: 'eCash는 수탁형 지갑인가요?',
          a: '아니요, Cashu eCash는 전통적인 수탁형 지갑과 다릅니다. eCash 토큰은 귀하의 브라우저에만 저장되며, Mint 서버는 토큰을 보관하지 않습니다. Mint는 단지 토큰을 발행하고 상환하는 역할만 하며, 누가 어떤 토큰을 가지고 있는지 추적할 수 없습니다.'
        },
        {
          q: 'eCash의 주요 장점은 무엇인가요?',
          a: '1) 프라이버시: Mint조차 누가 어떤 토큰을 사용하는지 알 수 없습니다. 2) 즉시 결제: 라이트닝 네트워크를 통한 즉각적인 송수신. 3) 낮은 수수료: 소액 결제에 최적화. 4) 오프라인 거래: 인터넷 없이도 토큰 교환 가능.'
        }
      ]
    },
    {
      category: '지갑 사용법',
      items: [
        {
          q: '라이트닝 결제를 어떻게 받나요?',
          a: '지갑 페이지에서 "받기" 버튼을 클릭하고 금액을 입력한 후 인보이스를 생성하세요. QR 코드가 표시되면 상대방이 스캔하여 결제할 수 있습니다. 결제가 완료되면 자동으로 eCash로 변환되어 잔액에 추가됩니다.'
        },
        {
          q: '라이트닝 결제를 어떻게 보내나요?',
          a: '"보내기" 버튼을 클릭하고 라이트닝 인보이스(lnbc...)를 붙여넣으세요. 라이트닝 주소(user@domain)도 금액과 함께 입력하면 자동으로 인보이스를 생성합니다. 수수료 예치금이 포함되며, 남는 금액은 eCash로 반환됩니다.'
        },
        {
          q: '백업은 왜 중요한가요?',
          a: 'eCash 토큰은 브라우저의 로컬 저장소에만 저장됩니다. 브라우저 데이터를 삭제하거나 캐시를 지우면 잔액이 영구적으로 사라집니다. 반드시 백업 파일(JSON)을 다운로드하여 안전한 곳에 보관하세요. 백업 파일이 있으면 언제든지 복구할 수 있습니다.'
        },
        {
          q: '여러 기기에서 사용할 수 있나요?',
          a: '네, 백업 파일을 다른 기기로 옮겨서 복구하면 됩니다. 단, 동일한 토큰을 여러 기기에서 동시에 사용하면 이중 지출로 인해 문제가 발생할 수 있으니, 한 번에 한 기기에서만 사용하는 것을 권장합니다.'
        }
      ]
    },
    {
      category: '수수료 & 기술',
      items: [
        {
          q: '수수료는 어떻게 되나요?',
          a: '라이트닝 송금 시 라우팅 수수료 예치금이 포함됩니다. 실제 수수료보다 많이 예치된 경우 남는 금액은 eCash 거스름돈으로 자동 반환됩니다. Mint는 수수료를 대신 지불하며, 대부분의 경우 예치금보다 적게 들어 남는 금액을 돌려받게 됩니다.'
        },
        {
          q: 'Mint는 믿을 수 있나요?',
          a: 'Mint는 eCash 토큰에 대해 비트코인을 상환해주는 역할을 합니다. 신뢰할 수 있는 Mint를 선택하는 것이 중요하며, 필요 시 다른 Mint로 토큰을 이동(스왑)할 수 있습니다. 현재 앱은 기본 Mint를 사용하며, 향후 여러 Mint 지원이 추가될 예정입니다.'
        },
        {
          q: '토큰이 도난당하거나 분실되면?',
          a: 'eCash 토큰은 물리적 현금과 유사합니다. 백업 파일이 없으면 복구할 수 없으므로 반드시 안전하게 보관하세요. 백업 파일을 암호화된 USB나 클라우드에 저장하는 것을 권장합니다.'
        },
        {
          q: '블라인드 서명(Blind Signature)이란?',
          a: 'Chaumian eCash의 핵심 기술로, Mint가 토큰에 서명할 때 토큰의 내용을 알 수 없도록 하는 암호학적 기법입니다. 이를 통해 Mint조차도 누가 어떤 토큰을 사용하는지 추적할 수 없어 완전한 프라이버시를 보장합니다.'
        }
      ]
    },
    {
      category: '보안 & 프라이버시',
      items: [
        {
          q: '내 거래 내역이 추적될 수 있나요?',
          a: '아니요, Cashu의 블라인드 서명 기술 덕분에 Mint조차도 어떤 토큰을 누가 사용하는지 알 수 없습니다. 블록체인에도 거래 내역이 기록되지 않아 완전한 프라이버시를 제공합니다. 다만, Mint는 발행/상환 시점의 금액만 알 수 있습니다.'
        },
        {
          q: '개인정보는 어떻게 보호되나요?',
          a: '모든 eCash 토큰은 브라우저의 로컬 저장소에만 저장되며, 서버로 전송되지 않습니다. Mint는 토큰의 소유자를 파악할 수 없으며, 앱은 어떠한 개인정보도 수집하지 않습니다.'
        },
        {
          q: 'Mint가 해킹당하면 어떻게 되나요?',
          a: 'Mint의 개인키가 유출되면 공격자가 무제한으로 토큰을 발행할 수 있습니다. 하지만 귀하의 토큰 자체는 브라우저에 안전하게 저장되어 있으며, 즉시 다른 Mint로 이동하거나 라이트닝으로 인출하면 됩니다. 신뢰할 수 있는 Mint를 선택하는 것이 중요합니다.'
        },
        {
          q: '브라우저 확장 프로그램이 안전한가요?',
          a: '의심스러운 브라우저 확장 프로그램은 로컬 저장소에 접근하여 토큰을 탈취할 수 있습니다. 신뢰할 수 있는 확장 프로그램만 설치하고, 중요한 금액은 백업 파일로 안전하게 보관하세요.'
        }
      ]
    },
    {
      category: '문제 해결',
      items: [
        {
          q: '받은 잔액이 사라졌어요',
          a: '브라우저 저장소를 지우면 eCash 토큰이 영구 삭제됩니다. 백업 파일이 있다면 "복구" 버튼으로 복원할 수 있습니다. 백업이 없다면 복구가 불가능하므로, 반드시 정기적으로 백업하세요.'
        },
        {
          q: '인보이스 결제 후 잔액이 안 들어와요',
          a: '결제 확인에는 최대 2분이 소요될 수 있습니다. 페이지를 새로고침하거나 잠시 기다려보세요. 그래도 해결되지 않으면 백엔드 로그를 확인하여 quote ID를 찾아 수동으로 복구할 수 있습니다.'
        },
        {
          q: '송금이 실패했는데 잔액이 차감됐어요',
          a: '송금 실패 시 사용된 토큰은 소각되지 않고 남아있어야 합니다. 만약 잔액이 차감됐다면 브라우저를 새로고침해보세요. 문제가 지속되면 백업 파일로 복구하세요.'
        },
        {
          q: '라이트닝 주소로 송금이 안 돼요',
          a: '라이트닝 주소 송금 시 금액을 반드시 입력해야 합니다. 주소 형식이 올바른지(user@domain) 확인하고, 상대방의 라이트닝 주소가 활성화되어 있는지 확인하세요.'
        },
        {
          q: '추가 문의사항이 있어요',
          a: '위 FAQ로 해결되지 않는 문제가 있다면 onebitebitcoin@proton.me 로 문의해주세요. 최대한 빠르게 답변드리겠습니다.'
        }
      ]
    }
  ];

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="bitcoin-icon"><Icon name="info" size={64} /></span>
            자주 묻는 질문 (FAQ)
          </h1>
          <p className="hero-subtitle">
            Cashu eCash와 한입 지갑에 대해 궁금한 모든 것
          </p>
        </div>
      </div>

      <div className="info-section">
        <div className="info-content">
          {faqs.map((category, catIndex) => (
            <div key={catIndex} style={{ marginBottom: '3rem' }}>
              <h2 style={{
                marginBottom: '1.5rem',
                fontSize: '1.75rem',
                color: 'var(--primary)',
                fontWeight: '700'
              }}>
                {category.category}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {category.items.map((faq, index) => {
                  const globalIndex = `${catIndex}-${index}`;
                  const isOpen = openIndex === globalIndex;

                  return (
                    <div
                      key={index}
                      style={{
                        background: 'var(--card-bg)',
                        backdropFilter: 'blur(10px)',
                        border: '2px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        overflow: 'hidden',
                        transition: 'all 0.3s',
                        boxShadow: isOpen ? 'var(--shadow-md)' : 'var(--shadow-sm)'
                      }}
                    >
                      <button
                        onClick={() => toggleFAQ(globalIndex)}
                        style={{
                          width: '100%',
                          padding: '1.25rem 1.5rem',
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '1rem',
                          fontSize: '1.1rem',
                          fontWeight: '600',
                          color: 'var(--text)'
                        }}
                      >
                        <span>{faq.q}</span>
                        <Icon name={isOpen ? 'close' : 'info'} size={20} />
                      </button>
                      {isOpen && (
                        <div
                          style={{
                            padding: '0 1.5rem 1.25rem 1.5rem',
                            background: 'rgba(var(--primary-rgb), 0.03)',
                            borderTop: '1px solid var(--border)',
                            color: 'var(--text)',
                            lineHeight: '1.8',
                            animation: 'fadeIn 0.3s ease-out'
                          }}
                        >
                          {faq.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default About;
