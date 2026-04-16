(function () {
  const landingConfig = {
    downloads: {
      macAppleSilicon: '#download-mac-apple-silicon',
      macIntel: '#download-mac-intel',
      windows: '#download-windows',
    },
    assets: {
      hero: './main.png',
      flowTask: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_1_oversea-CmFaKSv5.svg',
      flowExecution: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_2_oversea-mO2x2CNR.svg',
      flowReturn: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_3_oversea-YgMI_tfu.svg',
    },
    legal: {
      privacy: '#privacy-policy',
      terms: '#terms-of-service',
    },
    copy: {
      heroTitle: '你的私人智能助理',
      heroDescription:
        '不在云端，更胜云端，你的第二大脑，就在你的电脑上',
      flowTitle: '它不是一个全能Agent',
      flowIntro:
        '很多人告诉你可以用它干任何事情，但它更适合用来拓展你的记忆和执行力，把它当做你的贴心副手',
      flowCard1Title: '连接你的常用IM',
      flowCard1Description: '支持微信、企业微信、飞书、钉钉等IM工具，让你的智能助理触手可及。',
      flowCard2Title: '记住你，记住你的一切',
      flowCard2Description: '拟人化记忆，和你一样独一无二的灵魂，用久了比你还懂你。',
      flowCard3Title: '搭建一人团队',
      flowCard3Description: '轻松搭建Agent矩阵，让一整个AI团队成为你的左膀右臂。',
    },
  };

  function setAttribute(selector, attribute, value) {
    const element = document.querySelector(selector);
    if (element) {
      element.setAttribute(attribute, value);
    }
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  }

  function applyLandingConfig() {
    setAttribute('[data-download-target="mac-apple-silicon"]', 'href', landingConfig.downloads.macAppleSilicon);
    setAttribute('[data-download-target="mac-intel"]', 'href', landingConfig.downloads.macIntel);
    setAttribute('[data-download-target="windows"]', 'href', landingConfig.downloads.windows);

    setAttribute('[data-hero-image]', 'src', landingConfig.assets.hero);
    setAttribute('[data-flow-image="task"]', 'src', landingConfig.assets.flowTask);
    setAttribute('[data-flow-image="execution"]', 'src', landingConfig.assets.flowExecution);
    setAttribute('[data-flow-image="return"]', 'src', landingConfig.assets.flowReturn);

    setAttribute('[data-legal-link="privacy"]', 'href', landingConfig.legal.privacy);
    setAttribute('[data-legal-link="terms"]', 'href', landingConfig.legal.terms);

    setText('[data-copy="hero-title"]', landingConfig.copy.heroTitle);
    setText('[data-copy="hero-description"]', landingConfig.copy.heroDescription);
    setText('[data-copy="flow-title"]', landingConfig.copy.flowTitle);
    setText('[data-copy="flow-intro"]', landingConfig.copy.flowIntro);
    setText('[data-copy="flow-card-1-title"]', landingConfig.copy.flowCard1Title);
    setText('[data-copy="flow-card-1-description"]', landingConfig.copy.flowCard1Description);
    setText('[data-copy="flow-card-2-title"]', landingConfig.copy.flowCard2Title);
    setText('[data-copy="flow-card-2-description"]', landingConfig.copy.flowCard2Description);
    setText('[data-copy="flow-card-3-title"]', landingConfig.copy.flowCard3Title);
    setText('[data-copy="flow-card-3-description"]', landingConfig.copy.flowCard3Description);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLandingConfig, { once: true });
  } else {
    applyLandingConfig();
  }
})();
