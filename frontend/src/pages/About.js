import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './Home.css';
import Icon from '../components/Icon';

function About() {
  const { t, i18n } = useTranslation();
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    document.title = t('pageTitle.faq');
  }, [t, i18n.language]);

  const faqs = [
    {
      category: t('faq.categories.basics'),
      items: [
        { q: t('faq.basics.whatIsCashu.q'), a: t('faq.basics.whatIsCashu.a') },
        { q: t('faq.basics.isCustodial.q'), a: t('faq.basics.isCustodial.a') },
        { q: t('faq.basics.advantages.q'), a: t('faq.basics.advantages.a') }
      ]
    },
    {
      category: t('faq.categories.usage'),
      items: [
        { q: t('faq.usage.howToReceive.q'), a: t('faq.usage.howToReceive.a') },
        { q: t('faq.usage.howToSend.q'), a: t('faq.usage.howToSend.a') },
        { q: t('faq.usage.whyBackup.q'), a: t('faq.usage.whyBackup.a') },
        { q: t('faq.usage.multiDevice.q'), a: t('faq.usage.multiDevice.a') }
      ]
    },
    {
      category: t('faq.categories.fees'),
      items: [
        { q: t('faq.fees.howFees.q'), a: t('faq.fees.howFees.a') },
        { q: t('faq.fees.trustMint.q'), a: t('faq.fees.trustMint.a') },
        { q: t('faq.fees.lostTokens.q'), a: t('faq.fees.lostTokens.a') },
        { q: t('faq.fees.blindSignature.q'), a: t('faq.fees.blindSignature.a') }
      ]
    },
    {
      category: t('faq.categories.security'),
      items: [
        { q: t('faq.security.tracked.q'), a: t('faq.security.tracked.a') },
        { q: t('faq.security.privacy.q'), a: t('faq.security.privacy.a') },
        { q: t('faq.security.mintHacked.q'), a: t('faq.security.mintHacked.a') },
        { q: t('faq.security.browserExtensions.q'), a: t('faq.security.browserExtensions.a') }
      ]
    },
    {
      category: t('faq.categories.troubleshooting'),
      items: [
        { q: t('faq.troubleshooting.balanceGone.q'), a: t('faq.troubleshooting.balanceGone.a') },
        { q: t('faq.troubleshooting.noBalance.q'), a: t('faq.troubleshooting.noBalance.a') },
        { q: t('faq.troubleshooting.failedButDeducted.q'), a: t('faq.troubleshooting.failedButDeducted.a') },
        { q: t('faq.troubleshooting.addressNotWorking.q'), a: t('faq.troubleshooting.addressNotWorking.a') },
        { q: t('faq.troubleshooting.moreQuestions.q'), a: t('faq.troubleshooting.moreQuestions.a') }
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
            {t('about.title')}
          </h1>
          <p className="hero-subtitle">
            {t('about.subtitle')}
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
                            padding: '1rem 1.5rem 1.25rem 1.5rem',
                            background: 'rgba(var(--primary-rgb), 0.03)',
                            borderTop: '1px solid var(--border)',
                            color: 'var(--text)',
                            lineHeight: '1.8',
                            textAlign: 'left',
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
