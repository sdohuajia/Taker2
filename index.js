const axios = require('axios');
const fs = require('fs').promises;
const chalk = require('chalk');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { ethers } = require('ethers');

// 延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 格式化剩余时间
function formatTimeRemaining(timeMs) {
  if (timeMs <= 0) return '0秒';
  const hours = Math.floor(timeMs / 3600000);
  const minutes = Math.floor((timeMs % 3600000) / 60000);
  const seconds = Math.floor((timeMs % 60000) / 1000);
  
  let timeString = '';
  if (hours > 0) timeString += hours + '小时 ';
  if (minutes > 0 || hours > 0) timeString += minutes + '分钟 ';
  timeString += seconds + '秒';
  return timeString.trim();
}

// 计算距离下一个北京时间中午12点的毫秒数
function getTimeUntilNextNoon() {
  const now = new Date();
  const beijingHour = (now.getUTCHours() + 8) % 24;
  const beijingMinutes = now.getUTCMinutes();
  const beijingSeconds = now.getUTCSeconds();
  
  let hoursUntilNoon;
  if (beijingHour > 12 || (beijingHour === 12 && (beijingMinutes > 0 || beijingSeconds > 0))) {
    hoursUntilNoon = 24 - beijingHour + 12;
  } else {
    hoursUntilNoon = 12 - beijingHour;
  }
  
  const minutesUntilNoon = hoursUntilNoon * 60 - beijingMinutes;
  const secondsUntilNoon = minutesUntilNoon * 60 - beijingSeconds;
  return secondsUntilNoon * 1000;
}

// 格式化时间显示函数
function formatDateTime(date) {
  const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return beijingDate.toISOString().replace('T', ' ').substring(0, 19) + ' (北京时间)';
}

// 显示标题
console.log(chalk.cyan.bold('=== Sowing Taker 自动挖矿与任务脚本 ===\n'));

// 加载 API 密钥
async function loadApiKey() {
  try {
    const data = await fs.readFile('api.txt', 'utf-8');
    const lines = data.split('\n').filter(line => 
      line.trim() !== '' && !line.trim().startsWith('#')
    );
    if (lines.length === 0) {
      throw new Error('api.txt 中未找到有效的 API 密钥');
    }
    const apiKey = lines[0].trim();
    console.log(chalk.green(`✅ 已加载 API 密钥: ${apiKey.slice(0, 8)}... 🔑`));
    return apiKey;
  } catch (error) {
    console.log(chalk.red(`❌ 加载 API 密钥出错: ${error.message}`));
    return null;
  }
}

// 加载邀请码
async function loadReferralCode() {
  try {
    const data = await fs.readFile('refer.txt', 'utf-8');
    const lines = data.split('\n').filter(line => 
      line.trim() !== '' && !line.trim().startsWith('#')
    );
    if (lines.length === 0) {
      console.log(chalk.yellow(`⚠️ refer.txt 中未找到邀请码，使用默认值: MPR4HWEW`));
      return 'MPR4HWEW';
    }
    const referralCode = lines[0].trim();
    console.log(chalk.green(`✅ 已加载邀请码: ${referralCode} 📨`));
    return referralCode;
  } catch (error) {
    console.log(chalk.red(`❌ 加载邀请码出错: ${error.message}`));
    console.log(chalk.yellow(`⚠️ 使用默认邀请码: MPR4HWEW`));
    return 'MPR4HWEW';
  }
}

// 加载代理
async function loadProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').filter(line => line.trim() !== '');
    console.log(chalk.green(`✅ 已加载 ${proxies.length} 个代理 🌐`));
    return proxies;
  } catch (error) {
    console.log(chalk.red(`❌ 加载代理出错: ${error.message}`));
    return [];
  }
}

// 创建代理
function createProxyAgent(proxy) {
  if (proxy.startsWith('http://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks5://') || proxy.startsWith('socks4://')) {
    return new SocksProxyAgent(proxy);
  }
  return null;
}

// 从keys.txt加载私钥
async function loadPrivateKeys() {
  try {
    const data = await fs.readFile('keys.txt', 'utf-8');
    const lines = data.split('\n').filter(line => 
      line.trim() !== '' && !line.trim().startsWith('#')
    );
    
    const wallets = [];
    for (const privateKey of lines) {
      try {
        const wallet = new ethers.Wallet(privateKey.trim());
        wallets.push({
          address: wallet.address,
          privateKey: privateKey.trim()
        });
      } catch (err) {
        console.log(chalk.red(`❌ 无效的私钥: ${privateKey.slice(0, 10)}...`));
      }
    }
    
    console.log(chalk.green(`✅ 已加载 ${wallets.length} 个钱包 📋`));
    return wallets;
  } catch (error) {
    console.log(chalk.red(`❌ 加载私钥出错:`, error.message));
    return [];
  }
}

// 生成随机数
async function generateNonce(walletAddress, proxyAgent) {
  try {
    const response = await axios.post(
      'https://sowing-api.taker.xyz/wallet/generateNonce',
      { walletAddress },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.data.code === 200) {
      return response.data.result.nonce;
    }
    throw new Error('生成随机数失败');
  } catch (error) {
    throw error;
  }
}

// 执行登录
async function performLogin(wallet, proxyAgent, invitationCode) {
  try {
    const nonce = await generateNonce(wallet.address, proxyAgent);
    console.log(chalk.yellow(`🔐 正在登录钱包...`));
    const walletInstance = new ethers.Wallet(wallet.privateKey);
    const signature = await walletInstance.signMessage(nonce);
    
    const loginData = {
      address: wallet.address,
      invitationCode,
      message: nonce,
      signature
    };

    const response = await axios.post(
      'https://sowing-api.taker.xyz/wallet/login',
      loginData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.data.code === 200) {
      console.log(chalk.green(`✅ 钱包登录成功: ${wallet.address} 🔑`));
      return response.data.result.token;
    }
    throw new Error('登录失败: ' + (response.data.message || "未知错误"));
  } catch (error) {
    throw error;
  }
}

// 获取用户信息（挖矿模式）
async function getUserInfo(token, proxyAgent) {
  try {
    const response = await axios.get(
      'https://sowing-api.taker.xyz/user/info',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.data.code === 200) {
      const { takerPoints, consecutiveSignInCount, rewardCount } = response.data.result;
      console.log(chalk.cyan(`ℹ️ 用户信息: 积分=${takerPoints}, 签到次数=${consecutiveSignInCount}, 奖励=${rewardCount} 🧑‍💻`));
      return response.data.result;
    }
    throw new Error('获取用户信息失败');
  } catch (error) {
    throw error;
  }
}

// Turnstile 验证函数
async function solveTurnstile(proxyAgent, clientKey, action = 'mining') {
  try {
    const response = await axios.post(
      'https://api.capsolver.com/createTask',
      {
        clientKey,
        task: {
          type: "AntiTurnstileTaskProxyLess",
          websiteURL: "https://sowing.taker.xyz",
          websiteKey: "0x4AAAAAABNqF8H4KF9TDs2O",
          metadata: {
            action
          }
        }
      },
      {
        httpsAgent: proxyAgent
      }
    );

    if (response.data.errorId === 0) {
      const taskId = response.data.taskId;
      console.log(chalk.yellow(`🔄 Turnstile 验证中(${action})...请等待结果`));
      
      let attempts = 0;
      while (attempts < 10) {
        attempts++;
        await delay(2000);
        const resultResponse = await axios.post(
          'https://api.capsolver.com/getTaskResult',
          {
            clientKey,
            taskId
          },
          {
            httpsAgent: proxyAgent
          }
        );

        if (resultResponse.data.status === "ready") {
          console.log(chalk.green(`✅ Turnstile 验证成功`));
          return resultResponse.data.solution.token;
        }
        
        if (resultResponse.data.status === "failed") {
          throw new Error("Turnstile 验证失败: " + (response.data.errorDescription || "未知错误"));
        }
      }
      throw new Error("Turnstile 验证超时");
    }
    throw new Error("创建验证任务失败: " + (response.data.errorDescription || "未知错误"));
  } catch (error) {
    console.log(chalk.red(`❌ Turnstile 验证错误: ${error.message}`));
    throw error;
  }
}

// 领取挖矿奖励（挖矿模式）
async function claimMiningReward(token, proxyAgent, clientKey) {
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      console.log(chalk.yellow(`🔐 正在获取奖励领取验证码...${retryCount > 0 ? `(重试 ${retryCount}/${maxRetries})` : ''}`));
      const turnstileToken = await solveTurnstile(proxyAgent, clientKey, 'mining');
      
      const response = await axios.get(
        'https://sowing-api.taker.xyz/task/signIn?status=false',
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0',
            'Cf-Turnstile-Token': turnstileToken
          },
          httpsAgent: proxyAgent
        }
      );

      if (response.data.code === 200 && response.data.result) {
        console.log(chalk.green(`✅ 挖矿奖励领取成功 🎁`));
        return true;
      }
      
      if (response.data.message && response.data.message.includes("已领取")) {
        console.log(chalk.yellow(`⚠️ 今日奖励已领取过`));
        return true;
      }
      
      throw new Error('领取挖矿奖励失败: ' + (response.data.message || "未知错误"));
    } catch (error) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.log(chalk.red(`❌ 挖矿奖励领取失败，已重试 ${maxRetries} 次: ${error.message}`));
        throw error;
      }
      
      console.log(chalk.yellow(`⚠️ 领取失败，${maxRetries-retryCount+1}秒后重试... (${retryCount}/${maxRetries}): ${error.message}`));
      await delay((maxRetries-retryCount+1) * 1000);
    }
  }
}

// 获取任务详情（任务模式）
async function getTaskDetails(walletAddress, taskId, token, proxyAgent) {
  try {
    const response = await axios.get(
      `https://sowing-api.taker.xyz/task/detail?walletAddress=${walletAddress}&taskId=${taskId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.data.code === 200) {
      console.log(chalk.cyan(`ℹ️ 获取任务 ${taskId} 详情: ${walletAddress} 🧑‍💻`));
      return response.data.result;
    }
    throw new Error('获取任务详情失败');
  } catch (error) {
    throw error;
  }
}

// 检查任务（任务模式）
async function checkTask(token, taskData, proxyAgent) {
  try {
    const response = await axios.post(
      'https://sowing-api.taker.xyz/task/check',
      taskData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.data.code === 200 && response.data.result) {
      console.log(chalk.green(`✅ 任务检查成功: 任务ID=${taskData.taskId}, 事件ID=${taskData.taskEventId || 'N/A'} ✔️`));
      return true;
    }
    throw new Error('任务检查失败');
  } catch (error) {
    throw error;
  }
}

// 领取任务奖励（任务模式）
async function claimReward(token, taskId, proxyAgent) {
  try {
    const response = await axios.post(
      `https://sowing-api.taker.xyz/task/claim-reward?taskId=${taskId}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0'
        },
        httpsAgent: proxyAgent
      }
    );

    if (response.status === 200) {
      console.log(chalk.green(`✅ 任务ID=${taskId}的奖励领取成功 🎁`));
      return true;
    }
    throw new Error('领取奖励失败');
  } catch (error) {
    throw error;
  }
}

// 主函数
async function runBot() {
  // 加载 API 密钥
  const apiKey = await loadApiKey();
  if (!apiKey) {
    console.log(chalk.red(`❌ 未找到有效的 API 密钥，退出... 🚫`));
    return;
  }

  // 加载邀请码
  const invitationCode = await loadReferralCode();

  // 固定运行模式为挖矿 + 任务
  const mode = 3;

  // 固定并发数量为 3
  const concurrency = 3;
  console.log(chalk.cyan(`ℹ️ 并发数量设置为: ${concurrency}`));

  // 自动加载代理
  const proxies = await loadProxies();

  // 加载钱包
  const wallets = await loadPrivateKeys();
  if (wallets.length === 0) {
    console.log(chalk.red(`❌ 在keys.txt中未找到有效的私钥。退出... 🚫`));
    return;
  }

  // 固定任务模式循环次数为 1
  const numCycles = 1;

  // 默认启用定时挖矿
  const enableScheduling = true;

  // 任务模式配置
  const taskConfigs = [
    { taskId: 6, taskEventId: 1, answerList: ['C'] }, // 任务6-问题1
    { taskId: 6, taskEventId: 2, answerList: ['A'] }, // 任务6-问题2
    { taskId: 6, taskEventId: 3, answerList: ['D'] }, // 任务6-问题3
    { taskId: 7, taskEventId: 15 },                   // 任务7-关注
    { taskId: 7, taskEventId: 16 }                    // 任务7-访问
  ];

  // 处理单个钱包
  async function processWallet(wallet, index, proxyAgent, currentProxy) {
    try {
      console.log(chalk.blue(`📌 处理钱包 ${index + 1}/${wallets.length}: ${wallet.address}`));
      if (currentProxy) {
        console.log(chalk.yellow(`🌐 使用代理: ${currentProxy}`));
      }

      // 登录
      const token = await performLogin(wallet, proxyAgent, invitationCode);

      // 挖矿模式
      console.log(chalk.cyan(`⛏️ 执行挖矿模式...`));
      await getUserInfo(token, proxyAgent);
      await claimMiningReward(token, proxyAgent, apiKey);

      // 任务模式
      console.log(chalk.cyan(`📋 执行任务模式...`));
      const taskIds = [6, 7];
      for (const taskId of taskIds) {
        try {
          await getTaskDetails(wallet.address, taskId, token, proxyAgent);
          const tasksForId = taskConfigs.filter(config => config.taskId === taskId);
          for (const taskConfig of tasksForId) {
            await checkTask(token, taskConfig, proxyAgent);
            await delay(500);
          }
          await claimReward(token, taskId, proxyAgent);
          console.log(chalk.green(`✅ 任务ID=${taskId} 已完成!`));
        } catch (error) {
          console.log(chalk.red(`❌ 任务ID=${taskId} 处理失败: ${error.message}`));
        }
      }

      console.log(chalk.green(`✅ 钱包 ${wallet.address} 处理完成!`));
      return true;
    } catch (error) {
      console.log(chalk.red(`❌ 钱包 ${wallet.address} 处理失败: ${error.message}`));
      try {
        const errorLog = `${new Date().toISOString()} - 钱包 ${wallet.address} 处理失败: ${error.message}\n`;
        await fs.appendFile('error_log.txt', errorLog);
      } catch (logError) {
        console.log(chalk.red(`❌ 记录错误日志失败: ${logError.message}`));
      }
      return false;
    }
  }

  // 执行一次循环
  async function executeOneCycle(cycleCount = 1) {
    console.log(chalk.magenta(`\n🚀 开始第 ${cycleCount} 轮任务... ${new Date().toISOString()} 🕒\n`));
    const startTime = Date.now();

    for (let i = 0; i < wallets.length; i += concurrency) {
      const batch = wallets.slice(i, i + concurrency);
      const promises = batch.map((wallet, batchIndex) => {
        const walletIndex = i + batchIndex;
        let proxyAgent = null;
        let currentProxy = null;

        if (proxies.length > 0) {
          const proxyIndex = walletIndex % proxies.length;
          currentProxy = proxies[proxyIndex];
          proxyAgent = createProxyAgent(currentProxy);
        }

        return processWallet(wallet, walletIndex, proxyAgent, currentProxy);
      });

      await Promise.all(promises);
      if (i + concurrency < wallets.length) {
        await delay(2000);
      }
    }

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    console.log(chalk.green(`\n🎉 第 ${cycleCount} 轮任务完成!`));
    console.log(chalk.cyan(`⏱️ 执行时间: ${executionTime.toFixed(2)} 秒`));

    try {
      const executionLog = `${new Date().toISOString()} - 第 ${cycleCount} 轮任务完成，处理 ${wallets.length} 个钱包，耗时 ${executionTime.toFixed(2)} 秒\n`;
      await fs.appendFile('execution_log.txt', executionLog);
    } catch (logError) {
      console.log(chalk.red(`❌ 记录执行日志失败: ${logError.message}`));
    }

    return true;
  }

  // 综合模式（挖矿 + 任务）
  await executeOneCycle(1); // 执行一次
  // 定时挖矿
  async function scheduleNextExecution() {
    const msUntilNextNoon = getTimeUntilNextNoon();
    const nextExecutionTime = new Date(Date.now() + msUntilNextNoon);
    console.log(chalk.yellow(`\n⏰ 下次执行时间: ${formatDateTime(nextExecutionTime)}`));
    console.log(chalk.yellow(`⏳ 等待时间: ${formatTimeRemaining(msUntilNextNoon)} 🕒`));
    await delay(msUntilNextNoon);
    await executeOneCycle(1);
    scheduleNextExecution();
  }
  scheduleNextExecution();
}

// 运行机器人
runBot().catch(error => {
  console.log(chalk.red(`❌ 致命错误:`, error.message));
});
