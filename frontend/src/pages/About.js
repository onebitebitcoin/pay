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
            <div key={catIndex} className="faq-category">
              <h2 className="faq-category-title">
                {category.category}
              </h2>
              <div className="faq-list">
                {category.items.map((faq, index) => {
                  const globalIndex = `${catIndex}-${index}`;
                  const isOpen = openIndex === globalIndex;

                  return (
                    <div
                      key={index}
                      className={`faq-item ${isOpen ? 'open' : ''}`}
                    >
                      <button
                        onClick={() => toggleFAQ(globalIndex)}
                        className="faq-question"
                      >
                        <span>{faq.q}</span>
                        <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} />
                      </button>
                      {isOpen && (
                        <div className="faq-answer">
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
