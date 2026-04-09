(function () {
  const landingConfig = {
    downloads: {
      macAppleSilicon: '#download-mac-apple-silicon',
      macIntel: '#download-mac-intel',
      windows: '#download-windows',
    },
    assets: {
      hero: 'https://autoglm.zhipuai.cn/autoclaw/assets/AutoClaw_workspace_preview_img-C24yx-a3.png',
      flowTask: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_1_oversea-CmFaKSv5.svg',
      flowExecution: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_2_oversea-mO2x2CNR.svg',
      flowReturn: 'https://autoglm.zhipuai.cn/autoclaw/assets/Frame_3_oversea-YgMI_tfu.svg',
    },
    legal: {
      privacy: '#privacy-policy',
      terms: '#terms-of-service',
    },
    copy: {
      heroTitle: '将 Agent 执行力装进一个对话入口',
      heroDescription:
        '一键激活 GeeClaw 智能体分身，自主调用专业工具，让复杂任务在一个统一入口里持续推进、执行并回流结果。',
      flowTitle: '它看起来像聊天，实际上是一条执行通道',
      flowIntro:
        '用户在一个对话框发起目标，GeeClaw 往下拆解、执行，再把结果与上下文一起回流到当前工作流里。',
      flowCard1Title: '发起任务',
      flowCard1Description: '任务入口就是一条对话，不是配置页，也不是另一套任务系统。',
      flowCard2Title: '分身执行',
      flowCard2Description: '智能体继续推进，本地工具真实执行，步骤和状态都在同一条轨道里展开。',
      flowCard3Title: '结果回流',
      flowCard3Description: '接住的不只是结论，还有上下文、进展和下一步接力点。',
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
