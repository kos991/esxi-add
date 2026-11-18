import type { FileMetadata } from '../types'

export type DriverCategoryKey =
  | 'community'
  | 'modded'
  | 'raid'
  | 'network'
  | 'storage'
  | 'oem-addon'
  | 'other'

export interface DriverDetailMeta {
  zhName: string
  moduleCode: string
  hardwareChip?: string
  summary: string
  subtitle: string
  category: DriverCategoryKey
  categoryLabel: string
  categoryColor: string
  cleanVersion?: string
}

export interface DepotDetailMeta {
  zhName: string
  subtitle: string
  oemBrand?: string
  cleanVersion?: string
  badgeLabel: string
  badgeColor: string
}

/**
 * 提取简短干净的驱动模块代号（如 lsi-mr3、i40en、r8125），彻底剥离 VMW_bootbank_ 与超长构建后缀
 */
export function extractModuleCode(rawNameOrPath: string): string {
  if (!rawNameOrPath) return ''
  const base = (rawNameOrPath.split('/').pop() || rawNameOrPath).replace(/\.(vib|zip)$/i, '')

  // 如果本来就是短代号（例如单测或手工录入的 net-community、r8125）
  if (base.length <= 22 && !/^(vmw|vmware|mod)_bootbank_/i.test(base)) {
    return base
  }

  // 处理 VMW_bootbank_<module>_<ver> / VMware_bootbank_<module>_<ver> / MOD_bootbank_<module>_<ver>
  const bootbank = base.match(/^(?:vmw|vmware|mod)_bootbank_([a-z0-9-]+?)_(?:\d|[a-z]+-ip)/i)
  if (bootbank?.[1]) {
    return bootbank[1]
  }

  // 处理 VMW-ESX-6.5.0-<module>-<ver>
  const esxLegacy = base.match(/^vmw-esx-\d+\.\d+(?:\.\d+)?-([a-z0-9_-]+?)-\d/i)
  if (esxLegacy?.[1]) {
    return esxLegacy[1]
  }

  // 处理常见离线包名
  const lower = base.toLowerCase()
  if (lower.includes('vmkusb')) return 'vmkusb-nic-fling'
  if (lower.includes('net-community')) return 'net-community'
  if (lower.includes('nvme-community')) return 'nvme-community'
  if (lower.includes('re-driver')) return 're-driver'
  if (lower.includes('net-igb')) return 'net-igb'
  if (lower.includes('r8125')) return 'r8125'
  if (lower.includes('r8168')) return 'r8168'
  if (lower.includes('connectx3') || lower.includes('nmlx4')) return 'nmlx4-bundle'
  if (lower.includes('cx4421') || lower.includes('connectx4')) return 'nmlx5-bundle'
  if (lower.includes('dell') && lower.includes('addon')) return 'dell-addon'
  if (lower.includes('hpe') && lower.includes('addon')) return 'hpe-addon'

  // 通用截断：去掉版本号尾巴
  const stripped = base
    .replace(/^(?:VMW|VMware|MOD)_bootbank_/i, '')
    .replace(/[-_]\d+\.\d+.*$/i, '')
    .replace(/[-_](?:offline[-_]?bundle|component|depot).*$/i, '')
  return stripped.slice(0, 24) || base.slice(0, 24)
}

/**
 * 从长文件名或混杂版本号中提取真正可读的短版本号，拒绝将文件名或无意义词作为版本号
 */
export function extractCleanDriverVersion(raw: string): string {
  if (!raw) return ''
  const base = (raw.split('/').pop() || raw).replace(/\.(vib|zip)$/i, '')

  // 如果本身就是干净的短版本号（如 1.2.7 / 9.011.00-10）
  if (/^\d+(?:\.\d+)+(?:-[a-z0-9]+)?$/i.test(base) && base.length <= 22) {
    return base
  }

  // Dell Addon: Dell_Addon_8.0.3_A11 / Dell-Addon-9.0.0.0-X31 / Dell-Addon-9.1.0.0-A00
  const dellAddon = base.match(/addon[-_](\d+\.\d+(?:\.\d+)*)[-_]([a-z]\d{2})/i)
  if (dellAddon) {
    return `${dellAddon[1]} ${dellAddon[2].toUpperCase()}`
  }

  // HPE Addon: HPE-803.0.0.12.3.0.6-apr2026-Addon-depot
  const hpeAddon = base.match(/^hpe[-_](\d+\.\d+\.\d+\.\d+(?:\.\d+)?)/i)
  if (hpeAddon) {
    return hpeAddon[1]
  }

  // USB Fling: ESXi803-VMKUSB-NIC-FLING-93415869-component -> Fling #93415869
  const fling = base.match(/fling[-_](\d{6,10})/i)
  if (fling) {
    return `Build ${fling[1]}`
  }

  // bootbank 标准格式: _<ver>-<N>vmw... 或 _<ver>-<N>mod... 或 _<ver>-<N>oem...
  const vmwVer = base.match(/_(\d+\.\d+(?:\.\d+)*)-\d+(?:vmw|mod|oem)/i)
  if (vmwVer?.[1]) {
    return vmwVer[1]
  }

  // VMW-ESX-6.5.0-lsi_mr3-6.912.12.00-4556616 -> 6.912.12.00
  const legacyEsx = base.match(/^vmw-esx-\d+\.\d+(?:\.\d+)?-[a-z0-9_]+-(\d+\.\d+(?:\.\d+)*)/i)
  if (legacyEsx?.[1]) {
    return legacyEsx[1]
  }

  // 通用 _1.2.7.0- 或 -9.011.00-10 或 -8.045a-
  const generic = base.match(/[_-](\d+\.\d+(?:\.\d+)*[a-z]?)(?:[-_.]|$)/i)
  if (generic?.[1] && generic[1].length <= 20) {
    return generic[1]
  }

  return ''
}

function buildDriverResult(
  file: Partial<FileMetadata>,
  info: Omit<DriverDetailMeta, 'moduleCode' | 'subtitle' | 'cleanVersion'> & {
    moduleCode?: string
    cleanVersion?: string
  }
): DriverDetailMeta {
  const rawSource = file.driver_name || file.path || ''
  const moduleCode = info.moduleCode || extractModuleCode(rawSource)
  const cleanVersion =
    info.cleanVersion ??
    extractCleanDriverVersion(file.driver_version || '') ??
    extractCleanDriverVersion(rawSource)
  const finalVer = cleanVersion || extractCleanDriverVersion(rawSource) || undefined
  const subtitle = info.hardwareChip
    ? `${info.hardwareChip} · ${info.summary}`
    : info.summary

  return {
    ...info,
    moduleCode,
    cleanVersion: finalVer,
    subtitle,
  }
}

/**
 * 智能解析驱动的中文名称、模块短代号、支持芯片/硬件型号与一句话说明
 */
export function resolveDriverMeta(file?: Partial<FileMetadata> | null): DriverDetailMeta {
  if (!file) {
    return {
      zhName: '未知驱动',
      moduleCode: 'driver',
      summary: 'ESXi 扩展驱动组件',
      subtitle: 'ESXi 扩展驱动组件',
      category: 'other',
      categoryLabel: '驱动',
      categoryColor: 'default',
    }
  }

  const rawPath = (file.path || '').toLowerCase()
  const rawName = ((file.driver_name || '') + ' ' + (file.path?.split('/').pop() || '')).toLowerCase()
  const isModded =
    (file.driver_category || '').toLowerCase() === 'modded' ||
    rawPath.includes('/modded/') ||
    rawName.includes('mod_bootbank') ||
    rawName.includes('-modded')

  // 0. 魔改移植驱动（ESXi 8+ 解锁老神卡）
  if (isModded) {
    if (rawName.includes('atlantic') || rawName.includes('aqc')) {
      return buildDriverResult(file, {
        zhName: 'Aquantia AQC107 万兆网卡魔改驱动',
        moduleCode: 'atlantic-aqc107',
        hardwareChip: 'Marvell / Aquantia AQC107 · AQC108 万兆电口',
        summary: '解锁 ESXi 8.0 对华硕/QNAP 等消费级万兆电口网卡支持',
        category: 'modded',
        categoryLabel: '魔改驱动',
        categoryColor: 'purple',
      })
    }
    if (rawName.includes('connectx3') || rawName.includes('nmlx4')) {
      return buildDriverResult(file, {
        zhName: 'Mellanox ConnectX-3 万兆网卡解锁驱动包',
        moduleCode: 'nmlx4-esxi8',
        hardwareChip: 'ConnectX-3 / CX311A / CX312A / CX354A',
        summary: '移植恢复 ESXi 8.0 对 CX3 经典万兆/40G 光口网卡支持',
        category: 'modded',
        categoryLabel: '魔改驱动',
        categoryColor: 'purple',
      })
    }
    return buildDriverResult(file, {
      zhName: '社区魔改移植硬件驱动',
      hardwareChip: '移植兼容硬件扩展包',
      summary: '针对新版 ESXi 移除支持的经典硬件移植驱动',
      category: 'modded',
      categoryLabel: '魔改驱动',
      categoryColor: 'purple',
    })
  }

  // 1. 社区驱动（软路由 / 工控小主机常用）
  if (rawName.includes('vmkusb')) {
    return buildDriverResult(file, {
      zhName: 'USB 网卡通用驱动 (USB Network Fling)',
      moduleCode: 'vmkusb-nic-fling',
      hardwareChip: 'RTL8152 / RTL8153 / RTL8156 (2.5G) · AX88179',
      summary: '支持主流 USB 3.0 转千兆/2.5G 网口，小主机扩展网口必备',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('net-community')) {
    return buildDriverResult(file, {
      zhName: 'Intel 板载 2.5G/千兆社区网卡驱动',
      moduleCode: 'net-community',
      hardwareChip: 'Intel I225-V / I226-V / I219-V / I219-LM',
      summary: '工控机、软路由与消费级主板板载 Intel 网卡首选驱动',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('re-driver')) {
    return buildDriverResult(file, {
      zhName: 'Realtek 瑞昱 2.5G/千兆网卡合集驱动',
      moduleCode: 're-driver',
      hardwareChip: 'RTL8125B / RTL8125BG (2.5G) · RTL8168 / RTL8111',
      summary: '覆盖 ESXi 8 主流瑞昱板载与 PCIe 2.5G/千兆网卡',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('r8125')) {
    const isBundle = rawPath.endsWith('.zip')
    return buildDriverResult(file, {
      zhName: isBundle ? 'Realtek RTL8125 2.5G 网卡离线驱动包' : 'Realtek RTL8125 2.5G 网卡驱动',
      moduleCode: isBundle ? 'r8125-bundle' : 'net-r8125',
      hardwareChip: 'RTL8125 / RTL8125B / RTL8125BG 2.5GbE',
      summary: '小主机与独立 PCIe 2.5G 瑞昱网卡专用驱动',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('r8168')) {
    return buildDriverResult(file, {
      zhName: 'Realtek RTL8168/8111 千兆网卡驱动',
      moduleCode: 'net55-r8168',
      hardwareChip: 'RTL8168 / RTL8111 / RTL8411 板载千兆',
      summary: '兼容台式机与老款工控机常见瑞昱千兆网口',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('net-igb')) {
    return buildDriverResult(file, {
      zhName: 'Intel IGB 经典多口千兆社区驱动',
      moduleCode: 'net-igb',
      hardwareChip: 'Intel 82575 / 82576 / I210 / I350',
      summary: '老款四口千兆服务器网卡社区维护版驱动',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  if (rawName.includes('nvme-community')) {
    return buildDriverResult(file, {
      zhName: '消费级 NVMe 固态兼容补丁驱动',
      moduleCode: 'nvme-community',
      hardwareChip: '国产/消费级非标 M.2 NVMe SSD',
      summary: '解决部分消费级 NVMe 固态安装 ESXi 不认盘问题',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
    })
  }

  // 2. 硬件健康监控插件（严格区分各厂商/型号，避免同名混淆）
  if (rawName.includes('lsu-') || rawName.includes('lsuv2-')) {
    if (rawName.includes('hpsa')) {
      return buildDriverResult(file, {
        zhName: 'HPE HPSA 阵列卡状态监控插件',
        moduleCode: 'lsu-hpsa',
        hardwareChip: 'HP / HPE Smart Array HPSA 系列',
        summary: '提供 ESXi 存储健康状态与硬盘故障告警监控',
        category: 'raid',
        categoryLabel: '阵列卡',
        categoryColor: 'gold',
      })
    }
    if (rawName.includes('smartpqi')) {
      return buildDriverResult(file, {
        zhName: 'HPE SmartPQI 阵列状态监控插件',
        moduleCode: 'lsu-smartpqi',
        hardwareChip: 'HPE Gen10+ Smart Array P408i / E208i',
        summary: '上报 SmartPQI 控制器缓存与物理盘健康状态',
        category: 'raid',
        categoryLabel: '阵列卡',
        categoryColor: 'gold',
      })
    }
    if (rawName.includes('lsi-mr3')) {
      return buildDriverResult(file, {
        zhName: 'LSI MegaRAID 状态监控插件 (mr3)',
        moduleCode: 'lsu-lsi-mr3',
        hardwareChip: 'LSI MegaRAID 9361 / PERC H730 系列',
        summary: '配合 lsi-mr3 驱动上报 RAID 卷与磁盘健康状态',
        category: 'raid',
        categoryLabel: '阵列卡',
        categoryColor: 'gold',
      })
    }
    if (rawName.includes('msgpt3')) {
      return buildDriverResult(file, {
        zhName: 'LSI SAS 12G HBA 状态监控插件',
        moduleCode: 'lsu-lsi-mpt3',
        hardwareChip: 'LSI SAS 3008 / 3408 直通卡系列',
        summary: '配合 lsi-msgpt3 驱动提供磁盘 SMART 与槽位状态',
        category: 'raid',
        categoryLabel: '阵列卡',
        categoryColor: 'gold',
      })
    }
    if (rawName.includes('lsi')) {
      return buildDriverResult(file, {
        zhName: 'LSI 阵列与 HBA 通用状态监控插件',
        moduleCode: 'lsu-lsi',
        hardwareChip: 'LSI / Broadcom MegaRAID & SAS HBA 全系列',
        summary: '提供阵列控制器健康监测与管理支持',
        category: 'raid',
        categoryLabel: '阵列卡',
        categoryColor: 'gold',
      })
    }
    if (rawName.includes('intel') && rawName.includes('vmd')) {
      return buildDriverResult(file, {
        zhName: 'Intel VMD NVMe 控制器监控插件',
        moduleCode: 'lsu-intel-vmd',
        hardwareChip: 'Intel Xeon VMD 直连企业级 NVMe 盘位',
        summary: '支持服务器 Intel VMD 通道 NVMe 热插拔与点灯状态',
        category: 'storage',
        categoryLabel: '存储/HBA',
        categoryColor: 'cyan',
      })
    }
    if (rawName.includes('nvme')) {
      return buildDriverResult(file, {
        zhName: 'PCIe NVMe 固态健康监控插件',
        moduleCode: 'lsu-nvme',
        hardwareChip: '标准 PCIe / U.2 / M.2 NVMe 固态硬盘',
        summary: '采集 NVMe 固态温度、寿命与健康告警信息',
        category: 'storage',
        categoryLabel: '存储/HBA',
        categoryColor: 'cyan',
      })
    }
  }

  // 3. 企业级 / 服务器网卡驱动（子模块精细区分）
  if (rawName.includes('atlantic')) {
    return buildDriverResult(file, {
      zhName: 'Aquantia AQC107 万兆电口网卡驱动',
      moduleCode: 'atlantic',
      hardwareChip: 'AQC107 / AQC108 10G/5G/2.5G 电口',
      summary: '华硕 XG-C100C、QNAP 等万兆电口网卡官方驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('bnxtnet')) {
    return buildDriverResult(file, {
      zhName: 'Broadcom NetXtreme-E 10G/25G 网卡驱动',
      moduleCode: 'bnxtnet',
      hardwareChip: 'BCM57412 / BCM57414 / BCM57416 / BCM57504',
      summary: '戴尔/联想等主流服务器标配博通高速光口网卡驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('i40en')) {
    return buildDriverResult(file, {
      zhName: 'Intel X710 / XL710 万兆/40G 网卡驱动',
      moduleCode: 'i40en',
      hardwareChip: 'Intel X710 / XXV710 (25G) / XL710 (40G)',
      summary: 'Intel 700 系列服务器万兆/25G/40G 网卡核心驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('icen')) {
    return buildDriverResult(file, {
      zhName: 'Intel E810 25G/100G 旗舰网卡驱动',
      moduleCode: 'icen',
      hardwareChip: 'Intel E810-XXVDA2 / E810-CQDA2 系列',
      summary: 'Intel 800 系列新一代高速服务器网卡驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('ixgben')) {
    return buildDriverResult(file, {
      zhName: 'Intel X520 / X540 / X550 万兆网卡驱动',
      moduleCode: 'ixgben',
      hardwareChip: 'Intel 82599ES (X520) · X540-T2 · X550-T2',
      summary: '保有量最大的经典万兆光口/电口网卡官方驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('igbn')) {
    return buildDriverResult(file, {
      zhName: 'Intel I210 / I350 服务器千兆网卡驱动',
      moduleCode: 'igbn',
      hardwareChip: 'Intel I210 / I211 / I350 / I354 多口千兆',
      summary: '服务器板载千兆与四口千兆独立网卡官方驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx4-core')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-3 核心基础模块',
      moduleCode: 'nmlx4-core',
      hardwareChip: 'ConnectX-3 / CX311A / CX312A (底层依赖)',
      summary: 'CX3 网卡必选核心模块，需与 nmlx4-en 一同勾选',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx4-en')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-3 万兆以太网模块',
      moduleCode: 'nmlx4-en',
      hardwareChip: 'ConnectX-3 / CX311A / CX312A / CX354A',
      summary: 'CX3 10G/40G 以太网口主驱动，需配合 nmlx4-core 使用',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx4-rdma')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-3 RDMA 加速模块',
      moduleCode: 'nmlx4-rdma',
      hardwareChip: 'ConnectX-3 RoCE 硬件协议卸载',
      summary: '可选 RDMA 扩展模块，配合 nmlx4-core/en 提供低延迟传输',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('cx4421') || (rawName.includes('nmlx5') && rawPath.endsWith('.zip'))) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-4/5/6 完整离线驱动包',
      moduleCode: 'nmlx5-bundle',
      hardwareChip: 'CX4 Lx (CX4421A) / CX5 / CX6 25G~100G',
      summary: '一键集成 core + rdma 全套组件，无需拆分单选',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx5-core')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-4/5/6 核心主驱动',
      moduleCode: 'nmlx5-core',
      hardwareChip: 'ConnectX-4 Lx / ConnectX-5 / ConnectX-6',
      summary: '25G/40G/100G 迈络思网卡核心以太网驱动模块',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx5-rdma')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-4/5/6 RDMA 扩展模块',
      moduleCode: 'nmlx5-rdma',
      hardwareChip: 'ConnectX-4 / 5 / 6 RoCEv2 加速',
      summary: '提供 vSAN / iSER 高速存储网络 RDMA 硬件卸载支持',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('nmlx5-cc')) {
    return buildDriverResult(file, {
      zhName: 'Mellanox ConnectX-4/5/6 拥塞控制模块',
      moduleCode: 'nmlx5-cc',
      hardwareChip: 'ConnectX-4 / 5 / 6 无损网络流控',
      summary: 'RDMA 高负载场景拥塞控制辅助模块（可选）',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  if (rawName.includes('qfle3')) {
    return buildDriverResult(file, {
      zhName: 'QLogic FastLinQ 10G/25G 网卡驱动',
      moduleCode: 'qfle3',
      hardwareChip: 'QLogic / Marvell QL41xxx · QL45xxx',
      summary: '戴尔/惠普服务器常见 QLogic 万兆与 25G 网卡驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
    })
  }

  // 4. RAID 阵列卡与直通 HBA 驱动
  if (rawName.includes('lsi-mr3') || rawName.includes('lsi_mr3')) {
    return buildDriverResult(file, {
      zhName: 'LSI MegaRAID SAS 12G 阵列卡驱动',
      moduleCode: 'lsi-mr3',
      hardwareChip: 'MegaRAID 9361 / 9460 / 9560 · Dell PERC H730 / H740',
      summary: '主流服务器 12G 硬件 RAID 阵列控制器核心驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('lsi-msgpt2') || rawName.includes('lsi_msgpt2')) {
    return buildDriverResult(file, {
      zhName: 'LSI SAS 2008/2308 6G 直通卡驱动',
      moduleCode: 'lsi-msgpt2',
      hardwareChip: 'LSI 9211-8i / SAS2008 / SAS2308 · PERC H200 / H310',
      summary: '经典 All-in-One 飞牛/群晖硬盘直通 6G HBA 卡驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('lsi-msgpt' + '35') || rawName.includes('lsi_msgpt' + '35')) {
    return buildDriverResult(file, {
      zhName: 'LSI SAS 9400/35xx 三模直通卡驱动',
      moduleCode: 'lsi-msgpt' + '35',
      hardwareChip: 'LSI 9400-8i / 9400-16i / SAS3516 Tri-Mode',
      summary: '支持 SAS / SATA / NVMe 三模混合硬盘直通扩展卡驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('lsi-msgpt3') || rawName.includes('lsi_msgpt3')) {
    return buildDriverResult(file, {
      zhName: 'LSI SAS 3008/3408 12G 直通卡驱动',
      moduleCode: 'lsi-msgpt3',
      hardwareChip: 'LSI 9300-8i / SAS3008 / SAS3408 · Dell H330 / HBA330',
      summary: '主流 12Gbps SAS/SATA 硬盘直通扩展卡驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('lsi-uklst')) {
    return buildDriverResult(file, {
      zhName: 'LSI 阵列管理通信支持模块',
      moduleCode: 'lsi-uklst',
      hardwareChip: 'LSI MegaRAID StorCLI 底层管理接口',
      summary: '供 StorCLI 等管理工具读取阵列卡状态使用',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('nhpsa')) {
    return buildDriverResult(file, {
      zhName: 'HPE Smart Array Gen8/Gen9 阵列卡驱动',
      moduleCode: 'nhpsa',
      hardwareChip: 'HP Smart Array P420i / P440ar / P840 / H240',
      summary: '惠普 ProLiant Gen8 / Gen9 系列服务器阵列控制器驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  if (rawName.includes('smartpqi')) {
    return buildDriverResult(file, {
      zhName: 'HPE Smart Array Gen10+ 阵列卡驱动',
      moduleCode: 'smartpqi',
      hardwareChip: 'HPE P408i-a / E208i-a · Microchip Adaptec SmartRAID',
      summary: '惠普 Gen10/Gen11 服务器及 Adaptec 阵列卡官方驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
    })
  }

  // 5. 存储控制器 / 光纤 HBA
  if (rawName.includes('nvme-pcie')) {
    return buildDriverResult(file, {
      zhName: 'VMware 官方 PCIe NVMe 固态驱动',
      moduleCode: 'nvme-pcie',
      hardwareChip: '企业级 U.2 / PCIe / M.2 NVMe SSD',
      summary: 'VMware 原生高性能 NVMe 存储控制器驱动',
      category: 'storage',
      categoryLabel: '存储/HBA',
      categoryColor: 'cyan',
    })
  }

  if (rawName.includes('vmw-ahci')) {
    return buildDriverResult(file, {
      zhName: 'VMware 官方 SATA AHCI 控制器驱动',
      moduleCode: 'vmw-ahci',
      hardwareChip: 'Intel / AMD 主板原生 SATA 硬盘接口',
      summary: '驱动主板板载 SATA 接口与机械/固态硬盘',
      category: 'storage',
      categoryLabel: '存储/HBA',
      categoryColor: 'cyan',
    })
  }

  if (rawName.includes('lpfc')) {
    return buildDriverResult(file, {
      zhName: 'Emulex FC 光纤存储通道卡驱动',
      moduleCode: 'lpfc',
      hardwareChip: 'Emulex LPe12000 / LPe16000 / LPe32000 (8G/16G/32G FC)',
      summary: '连接光纤交换机与企业级 SAN 集中存储阵列',
      category: 'storage',
      categoryLabel: '存储/HBA',
      categoryColor: 'cyan',
    })
  }

  if (rawName.includes('elxiscsi')) {
    return buildDriverResult(file, {
      zhName: 'Emulex OneConnect iSCSI 硬件存储驱动',
      moduleCode: 'elxiscsi',
      hardwareChip: 'Emulex OneConnect 10Gb iSCSI HBA',
      summary: '硬件级 iSCSI 存储协议卸载控制器驱动',
      category: 'storage',
      categoryLabel: '存储/HBA',
      categoryColor: 'cyan',
    })
  }

  if (rawName.includes('pvscsi')) {
    return buildDriverResult(file, {
      zhName: 'VMware PVSCSI 准虚拟化存储驱动',
      moduleCode: 'pvscsi',
      hardwareChip: 'VMware Paravirtual SCSI 控制器',
      summary: '嵌套虚拟化或高吞吐准虚拟化磁盘控制器驱动',
      category: 'storage',
      categoryLabel: '存储/HBA',
      categoryColor: 'cyan',
    })
  }

  // 6. 品牌机 OEM Addon 扩展包
  if (rawName.includes('dell_addon') || rawName.includes('dell-addon') || rawPath.includes('dell_addon')) {
    return buildDriverResult(file, {
      zhName: 'Dell PowerEdge 官方驱动扩展包 (Addon)',
      moduleCode: 'dell-addon',
      hardwareChip: 'Dell PowerEdge 全系列网卡 / PERC 阵列 / iDRAC 组件',
      summary: '将标准官方源一键升级为戴尔服务器定制镜像的完整驱动集',
      category: 'oem-addon',
      categoryLabel: '品牌 Addon',
      categoryColor: 'volcano',
    })
  }

  if (rawName.includes('hpe-') && rawName.includes('addon')) {
    return buildDriverResult(file, {
      zhName: 'HPE ProLiant 官方驱动扩展包 (Addon)',
      moduleCode: 'hpe-addon',
      hardwareChip: 'HPE ProLiant 全系列网卡 / Smart Array / iLO 组件',
      summary: '将标准官方源一键升级为惠普服务器定制镜像的完整驱动集',
      category: 'oem-addon',
      categoryLabel: '品牌 Addon',
      categoryColor: 'volcano',
    })
  }

  // 7. 通用兜底（绝不拼接冗长乱码）
  const moduleCode = extractModuleCode(file.driver_name || file.path || '')
  const cleanDesc =
    file.driver_description && !/[\ufffd?]/.test(file.driver_description)
      ? file.driver_description
      : ''
  const cat: DriverCategoryKey = rawPath.includes('/community/')
    ? 'community'
    : rawPath.includes('/raid/')
      ? 'raid'
      : rawPath.includes('/network/')
        ? 'network'
        : rawPath.includes('/storage/')
          ? 'storage'
          : rawPath.includes('/oem-addon/')
            ? 'oem-addon'
            : ((file.driver_category as DriverCategoryKey) || 'other')

  const catMeta: Record<DriverCategoryKey, { label: string; color: string; fallbackTitle: string }> = {
    community: { label: '社区驱动', color: 'magenta', fallbackTitle: '社区扩展驱动' },
    modded: { label: '魔改驱动', color: 'purple', fallbackTitle: '魔改兼容驱动' },
    raid: { label: '阵列卡', color: 'gold', fallbackTitle: '阵列控制器驱动' },
    network: { label: '网卡', color: 'blue', fallbackTitle: '网络适配器驱动' },
    storage: { label: '存储/HBA', color: 'cyan', fallbackTitle: '存储控制器驱动' },
    'oem-addon': { label: '品牌 Addon', color: 'volcano', fallbackTitle: '品牌机驱动包' },
    other: { label: '驱动', color: 'default', fallbackTitle: 'ESXi 扩展驱动' },
  }

  return buildDriverResult(file, {
    zhName: moduleCode ? `${catMeta[cat].fallbackTitle} (${moduleCode})` : catMeta[cat].fallbackTitle,
    moduleCode: moduleCode || 'driver',
    summary: cleanDesc || 'ESXi 硬件扩展驱动包',
    category: cat,
    categoryLabel: catMeta[cat].label,
    categoryColor: catMeta[cat].color,
  })
}

function extractBuildNumber(raw: string): string {
  // 匹配 7~8 位 VMware Build 号（排除 201908001 / 202403001 这类 9 位日期补丁号）
  const matches = raw.match(/(?:^|[-_.])(\d{7,8})(?:[-_.]|$)/g)
  if (!matches) return ''
  for (const m of matches) {
    const digits = m.replace(/\D/g, '')
    if (!/^20[12]\d[01]\d/.test(digits)) {
      return digits
    }
  }
  return ''
}

function extractEsxiReleaseTag(raw: string, fallbackVer?: string): string {
  // 8.0U3k / 7.0U3w / 8.0U2
  const uShort = raw.match(/(\d+\.\d+)\s*(?:u|update0?)(\d+[a-z]?)/i)
  if (uShort) {
    return `${uShort[1]} U${uShort[2]}`
  }
  // 6.5.0.update03 -> 6.5 U3
  const uLong = raw.match(/(\d+\.\d+)(?:\.\d+)?\.update0?(\d+[a-z]?)/i)
  if (uLong) {
    return `${uLong[1]} U${uLong[2]}`
  }
  // 9.0.2.0100 / 9.1.0.0200 / 9.1.1.0 / 9.0.1.0 -> 9.0.2 / 9.1.0 / 9.1.1
  const v9 = raw.match(/(9\.\d+\.\d+)(?:\.\d+)?/i)
  if (v9) {
    return v9[1]
  }
  const vStd = raw.match(/(\d+\.\d+(?:\.\d+)?)/)
  return vStd?.[1] || fallbackVer || ''
}

/**
 * 解析 Depot / ISO 基础源及构建产出的清爽中文名称与副标题，消除重复版本号与文件名乱象
 */
export function resolveDepotMeta(file?: Partial<FileMetadata> | null): DepotDetailMeta {
  if (!file) {
    return {
      zhName: '未知安装源',
      subtitle: 'ESXi 基础镜像源',
      badgeLabel: '安装源',
      badgeColor: 'default',
    }
  }

  const rawPath = file.path || ''
  const lowerPath = rawPath.toLowerCase()
  const baseFile = rawPath.split('/').pop() || rawPath
  const rawName = (file.driver_name || baseFile).toLowerCase()
  const isIso = file.type === 'iso' || lowerPath.endsWith('.iso')

  // 0. 构建产出 ISO（保持真实自定义输出文件名，绝不误标为官方镜像）
  const trimmedLowPath = lowerPath.replace(/^\/+/, '')
  if (trimmedLowPath.startsWith('build/') || trimmedLowPath.startsWith('builds/') || trimmedLowPath.startsWith('output/')) {
    return {
      zhName: baseFile,
      subtitle: '流水线自定义构建产物 · 可直接下载刻录引导',
      cleanVersion: file.esxi_version ? `ESXi ${file.esxi_version}` : undefined,
      badgeLabel: '构建产物',
      badgeColor: 'green',
    }
  }

  const relTag = extractEsxiReleaseTag(baseFile, file.esxi_version)
  const buildNo = extractBuildNumber(baseFile)
  const buildText = buildNo ? `Build ${buildNo}` : ''

  // 1. Dell 戴尔定制
  if (rawName.includes('dell') || lowerPath.includes('oem-dell')) {
    const revMatch = baseFile.match(/[-_]([AX]\d{2})(?:\.|$)/i)
    const rev = revMatch ? revMatch[1].toUpperCase() : ''
    return {
      zhName: `Dell PowerEdge 定制版 ESXi ${relTag}${rev ? ` (${rev})` : ''}`,
      subtitle: ['集成戴尔服务器网卡、PERC 阵列卡与 iDRAC 管理组件', buildText].filter(Boolean).join(' · '),
      oemBrand: 'Dell 戴尔',
      cleanVersion: [relTag, rev].filter(Boolean).join(' ') || buildNo || undefined,
      badgeLabel: isIso ? 'Dell 定制 ISO' : 'Dell 离线包',
      badgeColor: 'cyan',
    }
  }

  // 2. H3C 新华三定制
  if (rawName.includes('h3c') || lowerPath.includes('oem-h3c')) {
    const h3cVer = baseFile.match(/customized[-_.]?(v\d+(?:\.\d+)?)/i)?.[1] || ''
    return {
      zhName: `H3C UniServer 定制版 ESXi ${relTag}${h3cVer ? ` (${h3cVer})` : ''}`,
      subtitle: ['集成新华三服务器阵列卡与板载网卡官方驱动', buildText].filter(Boolean).join(' · '),
      oemBrand: 'H3C 新华三',
      cleanVersion: [relTag, h3cVer].filter(Boolean).join(' ') || buildNo || undefined,
      badgeLabel: isIso ? 'H3C 定制 ISO' : 'H3C 离线包',
      badgeColor: 'purple',
    }
  }

  // 3. 浪潮 Inspur 定制
  if (rawName.includes('inspur') || lowerPath.includes('oem-inspur')) {
    const subVer = /8\.0\.0-1/.test(baseFile) ? '8.0 GA' : relTag
    return {
      zhName: `浪潮英信服务器定制版 ESXi ${subVer}`,
      subtitle: ['集成浪潮服务器专用网卡与 RAID 控制器驱动', buildText].filter(Boolean).join(' · '),
      oemBrand: 'Inspur 浪潮',
      cleanVersion: buildNo ? `${subVer} (${buildNo})` : subVer || undefined,
      badgeLabel: isIso ? '浪潮定制 ISO' : '浪潮离线包',
      badgeColor: 'orange',
    }
  }

  // 4. HPE 惠普定制
  if (rawName.includes('hpe') || lowerPath.includes('oem-hpe')) {
    return {
      zhName: `HPE ProLiant 定制版 ESXi ${relTag}`,
      subtitle: ['集成惠普 Smart Array 阵列卡与服务器网卡驱动', buildText].filter(Boolean).join(' · '),
      oemBrand: 'HPE 惠普',
      cleanVersion: relTag || buildNo || undefined,
      badgeLabel: isIso ? 'HPE 定制 ISO' : 'HPE 离线包',
      badgeColor: 'green',
    }
  }

  // 5. 日期号累积安全补丁包 (如 ESXi650-202403001.zip / ESXi670-202503001.zip)
  const datePatch = baseFile.match(/(20[12]\d[01]\d\d{3})/)?.[1]
  if (!isIso && datePatch) {
    return {
      zhName: `VMware ESXi ${file.esxi_version || relTag} 官方累积补丁包 (${datePatch})`,
      subtitle: 'VMware 官方安全修复与驱动累积升级离线包',
      cleanVersion: `Patch ${datePatch}`,
      badgeLabel: '官方补丁包',
      badgeColor: 'geekblue',
    }
  }

  // 6. 标准官方 Depot 离线包 (如 VMware-ESXi-8.0U3k-25595708-depot.zip)
  if (!isIso) {
    return {
      zhName: `VMware ESXi ${relTag} 官方标准离线包`,
      subtitle: ['VMware 原版纯净 Offline Bundle', buildText].filter(Boolean).join(' · '),
      cleanVersion: buildNo ? `Build ${buildNo}` : relTag || undefined,
      badgeLabel: '官方离线包',
      badgeColor: 'geekblue',
    }
  }

  // 7. 官方原版 ISO (如 VMware-VMvisor-Installer-8.0U3k-25595708.x86_64.iso / 201908001)
  const isoTitleVer = relTag || file.esxi_version || ''
  const isoPatchExtra = datePatch && !isoTitleVer.includes(datePatch) ? ` (${datePatch})` : ''
  return {
    zhName: `VMware ESXi ${isoTitleVer}${isoPatchExtra} 官方原版镜像`,
    subtitle: ['VMware 官方纯净标准安装镜像', buildText].filter(Boolean).join(' · '),
    cleanVersion: buildNo ? `Build ${buildNo}` : isoTitleVer || undefined,
    badgeLabel: '官方原版 ISO',
    badgeColor: 'blue',
  }
}
