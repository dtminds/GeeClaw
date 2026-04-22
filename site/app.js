(function () {
  const landingConfig = {
    releaseInfoUrl: 'https://geeclaw.dtminds.com/latest/release-info.json',
    fallbackReleasesUrl: 'https://github.com/dtminds/GeeClaw/releases',
    downloads: {
      macAppleSilicon: 'https://github.com/dtminds/GeeClaw/releases',
      macIntel: 'https://github.com/dtminds/GeeClaw/releases',
      windows: 'https://github.com/dtminds/GeeClaw/releases',
    },
    assets: {
      hero: './res/main.png',
      flowTask: './res/card1.png',
      flowExecution: './res/card2.png',
      flowReturn: './res/card3.png',
      flowSkills: './res/card4.png',
      flowSupervision: './res/card5.png',
      flowAutomation: './res/card6.png',
      flowPermissions: './res/card7.png',
      flowProviders: './res/card8.png',
      flowAutoUpdate: './res/card9.png',
    },
    legal: {
      privacy: '#privacy-policy',
      terms: '#terms-of-service',
    },
    copy: {
      heroTitle: '你的私人智能助理',
      heroDescription:
        '不在云端，就在你的电脑上',
      flowTitle: '它不是一个全能Agent',
      flowIntro:
        '很多人告诉你可以用它干任何事情，但它更适合用来拓展你的记忆和执行力，把它当做你的贴心副手',
      flowCard1Title: '连接你的常用IM',
      flowCard1Description: '支持微信、企业微信、飞书、钉钉等IM工具，让你的智能助理触手可及。',
      flowCard2Title: '记住你，记住你的一切',
      flowCard2Description: '拟人化记忆，和你一样独一无二的灵魂，用久了比你还懂你。',
      flowCard3Title: '自主进化',
      flowCard3Description: '它会从失败中学习，不断优化自己的策略和工具使用，成为更懂你的智能体。',
      flowCard4Title: '优雅的使用技能',
      flowCard4Description: '技能不是越多越好，知道什么时候用什么技能，是你跟我都该有的默契',
      flowCard5Title: '监管运行过程',
      flowCard5Description: '有时候我会言行不一，看看我在用什么工具执行任务，重要且必要！',
      flowCard6Title: '自动化运行',
      flowCard6Description: '将重复任务配置为自动化运行，并轻松查看每次运行',
      flowCard7Title: '权限管理',
      flowCard7Description: '大模型并不是绝对靠谱，在必要时审批 Agent 要执行的命令',
      flowCard8Title: '多 AI 供应商切换',
      flowCard8Description: '每个模型都有其擅长的一面，你可以自由切换模型，在性能和价格间自由平衡',
      flowCard9Title: '自动更新',
      flowCard9Description: '紧跟 OpenClaw 版本更新，集全球开发者智慧，及时享受最新功能、稳定性改进',
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

  function applyDownloadLinks(downloads) {
    setAttribute('[data-download-target="mac-apple-silicon"]', 'href', downloads.macAppleSilicon);
    setAttribute('[data-download-target="mac-intel"]', 'href', downloads.macIntel);
    setAttribute('[data-download-target="windows"]', 'href', downloads.windows);
  }

  function buildReleaseInfoUrl(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}ts=${Date.now()}`;
  }

  async function refreshDownloadLinks() {
    try {
      const response = await fetch(buildReleaseInfoUrl(landingConfig.releaseInfoUrl), {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Failed to load release metadata: ${response.status}`);
      }

      const releaseInfo = await response.json();
      const macArm64 = releaseInfo?.downloads?.mac?.arm64;
      const macX64 = releaseInfo?.downloads?.mac?.x64;
      const winX64 = releaseInfo?.downloads?.win?.x64;

      if (!macArm64 || !macX64 || !winX64) {
        throw new Error('Release metadata is missing download links');
      }

      applyDownloadLinks({
        macAppleSilicon: macArm64,
        macIntel: macX64,
        windows: winX64,
      });
    } catch (error) {
      console.warn('[GeeClaw site] Failed to refresh download links from OSS release-info.json', error);
      applyDownloadLinks({
        macAppleSilicon: landingConfig.fallbackReleasesUrl,
        macIntel: landingConfig.fallbackReleasesUrl,
        windows: landingConfig.fallbackReleasesUrl,
      });
    }
  }

  function applyLandingConfig() {
    applyDownloadLinks(landingConfig.downloads);

    setAttribute('[data-hero-image]', 'src', landingConfig.assets.hero);
    setAttribute('[data-flow-image="task"]', 'src', landingConfig.assets.flowTask);
    setAttribute('[data-flow-image="execution"]', 'src', landingConfig.assets.flowExecution);
    setAttribute('[data-flow-image="return"]', 'src', landingConfig.assets.flowReturn);
    setAttribute('[data-flow-image="skills"]', 'src', landingConfig.assets.flowSkills);
    setAttribute('[data-flow-image="supervision"]', 'src', landingConfig.assets.flowSupervision);
    setAttribute('[data-flow-image="automation"]', 'src', landingConfig.assets.flowAutomation);
    setAttribute('[data-flow-image="permissions"]', 'src', landingConfig.assets.flowPermissions);
    setAttribute('[data-flow-image="providers"]', 'src', landingConfig.assets.flowProviders);
    setAttribute('[data-flow-image="auto-update"]', 'src', landingConfig.assets.flowAutoUpdate);

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
    setText('[data-copy="flow-card-4-title"]', landingConfig.copy.flowCard4Title);
    setText('[data-copy="flow-card-4-description"]', landingConfig.copy.flowCard4Description);
    setText('[data-copy="flow-card-5-title"]', landingConfig.copy.flowCard5Title);
    setText('[data-copy="flow-card-5-description"]', landingConfig.copy.flowCard5Description);
    setText('[data-copy="flow-card-6-title"]', landingConfig.copy.flowCard6Title);
    setText('[data-copy="flow-card-6-description"]', landingConfig.copy.flowCard6Description);
    setText('[data-copy="flow-card-7-title"]', landingConfig.copy.flowCard7Title);
    setText('[data-copy="flow-card-7-description"]', landingConfig.copy.flowCard7Description);
    setText('[data-copy="flow-card-8-title"]', landingConfig.copy.flowCard8Title);
    setText('[data-copy="flow-card-8-description"]', landingConfig.copy.flowCard8Description);
    setText('[data-copy="flow-card-9-title"]', landingConfig.copy.flowCard9Title);
    setText('[data-copy="flow-card-9-description"]', landingConfig.copy.flowCard9Description);

    void refreshDownloadLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLandingConfig, { once: true });
  } else {
    applyLandingConfig();
  }
})();
