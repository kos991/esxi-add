import type { FileMetadata } from '../types'

export interface DriverDetailMeta {
  zhName: string
  hardwareChip?: string
  summary: string
  category: 'community' | 'raid' | 'network' | 'storage' | 'oem-addon' | 'other'
  categoryLabel: string
  categoryColor: string
  cleanVersion?: string
}

/**
 * 智能解析驱动的中文名称、支持芯片/硬件型号、精简版本号与说明
 */
export function resolveDriverMeta(file?: Partial<FileMetadata> | null): DriverDetailMeta {
  if (!file) {
    return {
      zhName: '未知驱动',
      summary: '驱动包',
      category: 'other',
      categoryLabel: '驱动',
      categoryColor: 'default',
    }
  }

  const rawPath = (file.path || '').toLowerCase()
  const rawName = (file.driver_name || file.path?.split('/').pop() || '').toLowerCase()
  const desc = (file.driver_description || '').toLowerCase()

  // 1. 社区网卡驱动
  if (rawName.includes('vmkusb') || rawPath.includes('vmkusb')) {
    return {
      zhName: 'VMware 官方 USB 扩展网卡驱动 (USB Fling)',
      hardwareChip: 'RTL8152 / RTL8153 / RTL8156 · AX88179',
      summary: '支持绝大多数 USB 3.0 转 RJ45 千兆及 2.5G 网卡，小主机扩展网口首选',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || '', 'Fling'),
    }
  }

  if (rawName.includes('net-community-driver') || rawPath.includes('net-community-driver')) {
    return {
      zhName: '社区板载网卡通用驱动包 (Community NIC)',
      hardwareChip: 'Intel I225-V / I226-V · Realtek 8125/8168',
      summary: '针对工控小主机主流板载 2.5G 与千兆网卡提供通用支持',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || '', '1.2.7.0'),
    }
  }

  if (rawName.includes('vmware-re-driver') || rawName.includes('re-driver')) {
    return {
      zhName: 'Realtek 瑞昱消费级网卡驱动包 (Re-Driver)',
      hardwareChip: 'RTL8125 / RTL8168 / RTL8111 家族',
      summary: '专为 ESXi 封装的瑞昱板载网卡驱动集合',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('r8125')) {
    return {
      zhName: 'Realtek RTL8125 2.5G 高速网卡驱动',
      hardwareChip: 'RTL8125 / RTL8125B / RTL8125BG 2.5GbE',
      summary: '主流独立 PCIe 2.5G 网卡与主板集成 2.5G 网卡专用驱动',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('r8168')) {
    return {
      zhName: 'Realtek RTL8168/8111 千兆网卡驱动',
      hardwareChip: 'RTL8168 / RTL8111 / RTL8411 PCIe 千兆',
      summary: '兼容老款台式机与工控机常见 Realtek 千兆板载网卡',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('net-igb')) {
    return {
      zhName: 'Intel IGB 经典千兆网卡社区驱动 (net-igb)',
      hardwareChip: 'Intel 82575 / 82576 / I210 / I350 芯片',
      summary: '针对老旧及社区维护版 Intel 千兆多口网卡驱动',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('nvme-community')) {
    return {
      zhName: '社区 NVMe 固态硬盘兼容补丁驱动',
      hardwareChip: '消费级/非标 M.2 NVMe SSD 固态硬盘',
      summary: '放宽 NVMe 协议握手限制，解决部分国产/消费级固态不认盘问题',
      category: 'community',
      categoryLabel: '社区驱动',
      categoryColor: 'magenta',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  // 2. 企业级 / 服务器网卡驱动
  if (rawName.includes('atlantic')) {
    return {
      zhName: 'Aquantia / Marvell AQC107 万兆网卡驱动',
      hardwareChip: 'AQC107 / AQC108 10G/5G/2.5G 电口网卡',
      summary: '华硕 XG-C100C、QNAP 等万兆电口网卡驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('bnxtnet')) {
    return {
      zhName: 'Broadcom 博通 NetXtreme-E 10G/25G 网卡驱动',
      hardwareChip: 'BCM57414 / BCM57412 / BCM57302 / 57404',
      summary: '戴尔/浪潮/联想服务器广泛搭载的 10G/25G SFP28 高速网卡',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('i40en')) {
    return {
      zhName: 'Intel 英特尔 700系列 10G/25G/40G 网卡驱动',
      hardwareChip: 'Intel X710 / XXV710 / XL710 芯片',
      summary: '企业级主流双口/四口 10G SFP+ 与 25G SFP28 光口网卡',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('icen')) {
    return {
      zhName: 'Intel 英特尔 800系列 100G 超高速网卡驱动',
      hardwareChip: 'Intel E810-C / E810-XXV 100G/25G 网卡',
      summary: '支持 100GbE QSFP28 高密度数据中心网卡',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('ixgben')) {
    return {
      zhName: 'Intel 英特尔 500系列/82599 万兆网卡驱动',
      hardwareChip: 'Intel X520 / X540 / X550 / 82599ES 万兆',
      summary: '最经典也是保有量最高的万兆双光口/电口网卡驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('igbn')) {
    return {
      zhName: 'Intel 英特尔 I210/I350 官方千兆网卡驱动',
      hardwareChip: 'Intel I210 / I211 / I350 / I354 多口千兆',
      summary: '服务器与工作站经典板载千兆与四口千兆网卡官方原生驱动',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('nmlx4') || rawName.includes('connectx3')) {
    return {
      zhName: 'Mellanox ConnectX-3 万兆/40G 网卡驱动',
      hardwareChip: 'Mellanox MCX311A / MCX312A / MCX354A (CX3)',
      summary: '经典性价比万兆/40G 双口网卡，支持 RoCE 硬件加速',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('nmlx4') || rawName.includes('connectx3') || rawName.includes('connectx-3')) {
    return {
      zhName: 'Mellanox ConnectX-3 万兆/40G 网卡驱动 (nmlx4)',
      hardwareChip: 'Mellanox ConnectX-3 / ConnectX-3 Pro (CX311/CX341)',
      summary: '高性价比 10G/40G 网卡，经典低功耗小主机/工控神卡',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (
    rawName.includes('nmlx5') ||
    rawName.includes('connectx4') ||
    rawName.includes('connectx5') ||
    rawName.includes('connectx6') ||
    rawName.includes('cx4421a')
  ) {
    return {
      zhName: 'Mellanox ConnectX-4/5/6 25G/100G 网卡驱动',
      hardwareChip: 'Mellanox CX4 / CX5 / CX6 / CX4421A 家族',
      summary: '高性能 25G/50G/100G 网卡，全面支持 RDMA/RoCEv2',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('qfle3')) {
    return {
      zhName: 'QLogic / Marvell FastLinQ 10G/25G 网卡驱动',
      hardwareChip: 'QLogic QL41xxx / QL45xxx FastLinQ 芯片',
      summary: '戴尔 Broadcom/QLogic 融合万兆网络适配器',
      category: 'network',
      categoryLabel: '网卡',
      categoryColor: 'blue',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  // 3. RAID 与阵列卡驱动
  if (rawName.includes('lsi-mr3') || rawName.includes('lsi_mr3')) {
    return {
      zhName: 'LSI / Broadcom MegaRAID SAS 12G 阵列卡驱动',
      hardwareChip: 'MegaRAID SAS 9361 / 9460 / 9560 · PERC H730/H740',
      summary: '企业级主流 12Gbps 硬件 RAID 控制器',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('lsi-msgpt2') || rawName.includes('lsi_msgpt2')) {
    return {
      zhName: 'LSI SAS 6Gbps 直通 HBA 卡驱动',
      hardwareChip: 'LSI SAS 2008 / 2308 IT模式 · PERC H200/H310',
      summary: '用于软路由/All-in-One 硬盘直通的 6Gbps HBA 卡',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('lsi-msgpt3') || rawName.includes('lsi_msgpt3')) {
    return {
      zhName: 'LSI SAS 12Gbps 直通 HBA 卡驱动',
      hardwareChip: 'LSI SAS 3008 / 3408 IT模式 · Dell H330/HBA330',
      summary: '12Gbps SAS/SATA 硬盘直通扩展卡专用驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('lsi-uklst')) {
    return {
      zhName: 'LSI SAS 阵列卡硬件管理支持插件 (uklst)',
      hardwareChip: 'LSI SAS 全系列状态监控',
      summary: '提供 CIM 硬件状态监控与 RAID 状态查询',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('nhpsa')) {
    return {
      zhName: 'HP / HPE Smart Array P410/P420/P440 阵列卡驱动',
      hardwareChip: 'HP Smart Array P410 / P420 / P440 / P822 控制器',
      summary: '惠普 ProLiant Gen8/Gen9 系列服务器阵列卡驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('smartpqi')) {
    return {
      zhName: 'Microsemi / HPE Gen10 阵列卡驱动 (SmartPQI)',
      hardwareChip: 'HPE Smart Array P408i / E208i · Adaptec 2100',
      summary: '惠普 ProLiant Gen10 及更新服务器阵列控制器驱动',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('lsu-') || rawName.includes('lsuv2-')) {
    return {
      zhName: '存储/阵列硬件健康状态上报插件',
      hardwareChip: 'RAID / HBA 硬件监控插件 (LSU Plugin)',
      summary: '向 ESXi 系统提供阵列卡磁盘健康与传感器度量',
      category: 'raid',
      categoryLabel: '阵列卡',
      categoryColor: 'gold',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  // 4. 存储控制器 / NVMe / 光纤卡
  if (rawName.includes('nvme-pcie')) {
    return {
      zhName: 'VMware 官方 NVMe PCIe 固态硬盘驱动',
      hardwareChip: 'PCIe NVMe SSD 固态硬盘',
      summary: '原生 PCIe NVMe 固态硬盘高性能驱动',
      category: 'storage',
      categoryLabel: '存储',
      categoryColor: 'cyan',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('vmw-ahci')) {
    return {
      zhName: 'VMware 官方 SATA AHCI 控制器驱动',
      hardwareChip: '主板原生 Intel/AMD SATA AHCI 控制器',
      summary: '驱动主板原生 SATA 接口与硬盘',
      category: 'storage',
      categoryLabel: '存储',
      categoryColor: 'cyan',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('lpfc')) {
    return {
      zhName: 'Emulex 光纤通道卡驱动 (Fibre Channel HBA)',
      hardwareChip: 'Emulex LPe12000 / LPe16000 / LPe32000 FC',
      summary: '连接 SAN 光纤交换机与集中存储阵列',
      category: 'storage',
      categoryLabel: '存储',
      categoryColor: 'cyan',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('elxiscsi')) {
    return {
      zhName: 'Emulex iSCSI 硬件适配驱动',
      hardwareChip: 'OneConnect 10Gb iSCSI 控制器',
      summary: '硬件级 iSCSI 协议卸载与存储适配',
      category: 'storage',
      categoryLabel: '存储',
      categoryColor: 'cyan',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('pvscsi')) {
    return {
      zhName: 'VMware 准虚拟化 SCSI 控制器驱动',
      hardwareChip: 'PVSCSI 适配器',
      summary: '高吞吐低延迟准虚拟化存储驱动',
      category: 'storage',
      categoryLabel: '存储',
      categoryColor: 'cyan',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  // 5. 品牌 Addon 扩展包
  if (rawName.includes('dell_addon') || rawName.includes('dell-addon') || rawPath.includes('dell_addon')) {
    return {
      zhName: 'Dell 戴尔官方 ESXi OEM 扩展硬件包 (Addon)',
      hardwareChip: 'Dell PowerEdge 全系列服务器驱动',
      summary: '集成戴尔服务器网卡、阵列卡与硬件传感器的官方扩展组件包',
      category: 'oem-addon',
      categoryLabel: '品牌 Addon',
      categoryColor: 'volcano',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  if (rawName.includes('hpe-') && rawName.includes('addon')) {
    return {
      zhName: 'HPE 惠普官方 ESXi OEM 扩展硬件包 (Addon)',
      hardwareChip: 'HPE ProLiant 全系列服务器驱动',
      summary: '集成惠普服务器网卡、阵列卡与硬件传感器的官方扩展组件包',
      category: 'oem-addon',
      categoryLabel: '品牌 Addon',
      categoryColor: 'volcano',
      cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
    }
  }

  // 通用后备匹配
  const cleanName = file.driver_name || file.path?.split('/').pop() || '驱动文件'
  const fallbackZhName = file.driver_description || (rawPath.includes('/network/') ? '网络驱动' : rawPath.includes('/raid/') ? '阵列卡驱动' : rawPath.includes('/storage/') ? '存储控制器驱动' : cleanName)

  return {
    zhName: fallbackZhName !== cleanName ? `${fallbackZhName} (${cleanName})` : cleanName,
    summary: file.driver_description || 'ESXi 扩展驱动包',
    category: (file.driver_category as any) || 'other',
    categoryLabel: file.driver_category === 'community' ? '社区驱动' : file.driver_category === 'raid' ? '阵列卡' : file.driver_category === 'network' ? '网卡' : file.driver_category === 'storage' ? '存储' : '驱动',
    categoryColor: 'default',
    cleanVersion: extractCleanDriverVersion(file.driver_name || file.path || ''),
  }
}

/**
 * 从长文件名或混杂版本号中提取真正有意义的短版本号，拒绝把文件名作为版本号
 */
export function extractCleanDriverVersion(raw: string, fallback?: string): string {
  if (!raw) return fallback || ''
  
  // 查找类似 1.2.7.0 / 216.0.50.0 / 9.011.00 / 7.728.02.00 等标准版本
  const match = raw.match(/_(\d+\.\d+(\.\d+)*(-\d+)?)[._-]|_(\d+\.\d+(\.\d+)*)$|-(\d+\.\d+(\.\d+)*(-[a-z0-9]+)?)[._-]/i)
  if (match) {
    const v = match[1] || match[4] || match[5]
    if (v && v.length < 24) return v
  }

  // 如果原始版本串已经是纯净版本号
  if (/^\d+(\.\d+)+(-[a-zA-Z0-9]+)?$/.test(raw) && raw.length <= 20) {
    return raw
  }

  return fallback || ''
}

/**
 * 解析 Depot / ISO 基础源的友好中文名称和品牌标识，彻底解决拼接乱象
 */
export function resolveDepotMeta(file?: Partial<FileMetadata> | null): {
  zhName: string
  oemBrand?: string
  cleanVersion?: string
  badgeLabel: string
  badgeColor: string
} {
  if (!file) {
    return { zhName: '未知安装源', badgeLabel: '安装源', badgeColor: 'default' }
  }

  const rawPath = (file.path || '').toLowerCase()
  const rawName = (file.driver_name || file.path?.split('/').pop() || '').toLowerCase()
  const isIso = file.type === 'iso' || rawPath.endsWith('.iso')

  // 戴尔定制
  if (rawName.includes('dell') || rawPath.includes('dell')) {
    const uMatch = rawName.match(/update0?([1-9])/i)
    const verMatch = rawName.match(/(\d+\.\d+(\.\d+)?)/)
    const verStr = verMatch ? verMatch[1] : (file.esxi_version || '')
    const updateStr = uMatch ? ` U${uMatch[1]}` : ''
    return {
      zhName: isIso ? `Dell EMC 官方定制安装镜像 (ESXi ${verStr}${updateStr})` : `Dell EMC 官方定制安装离线包 (ESXi ${verStr}${updateStr})`,
      oemBrand: 'Dell 戴尔',
      cleanVersion: `${verStr}${updateStr}`.trim(),
      badgeLabel: isIso ? 'Dell 定制 ISO' : 'Dell 离线包',
      badgeColor: 'cyan',
    }
  }

  // H3C 定制
  if (rawName.includes('h3c') || rawPath.includes('h3c')) {
    const verMatch = rawName.match(/(\d+\.\d+(\.\d+)?)/)
    const verStr = verMatch ? verMatch[1] : (file.esxi_version || '')
    return {
      zhName: isIso ? `新华三 H3C 官方定制安装镜像 (ESXi ${verStr})` : `新华三 H3C 官方定制安装离线包 (ESXi ${verStr})`,
      oemBrand: 'H3C 新华三',
      cleanVersion: verStr,
      badgeLabel: isIso ? 'H3C 定制 ISO' : 'H3C 离线包',
      badgeColor: 'purple',
    }
  }

  // 浪潮定制
  if (rawName.includes('inspur') || rawPath.includes('inspur')) {
    const verStr = file.esxi_version || '7.0'
    return {
      zhName: isIso ? `浪潮 Inspur 官方定制安装镜像 (ESXi ${verStr})` : `浪潮 Inspur 官方定制安装离线包 (ESXi ${verStr})`,
      oemBrand: 'Inspur 浪潮',
      cleanVersion: verStr,
      badgeLabel: isIso ? '浪潮定制 ISO' : '浪潮离线包',
      badgeColor: 'orange',
    }
  }

  // HPE 定制
  if (rawName.includes('hpe') || rawPath.includes('hpe')) {
    const verStr = file.esxi_version || '8.0'
    return {
      zhName: isIso ? `HPE 惠普官方定制安装镜像 (ESXi ${verStr})` : `HPE 惠普官方定制安装离线包 (ESXi ${verStr})`,
      oemBrand: 'HPE 惠普',
      cleanVersion: verStr,
      badgeLabel: isIso ? 'HPE 定制 ISO' : 'HPE 离线包',
      badgeColor: 'green',
    }
  }

  // 官方累积更新补丁包
  if (rawName.includes('official-patch') || rawPath.includes('official-patch') || /esxi\d+-\d{8}/i.test(rawName)) {
    const patchMatch = rawName.match(/(\d{8,9})/i)
    const verStr = file.esxi_version || ''
    const patchId = patchMatch ? patchMatch[1] : ''
    return {
      zhName: `ESXi ${verStr} 官方累积更新补丁包 ${patchId ? `(${patchId})` : ''}`.trim(),
      cleanVersion: patchId,
      badgeLabel: '官方升级包',
      badgeColor: 'geekblue',
    }
  }

  // 官方原版
  return {
    zhName: isIso ? `ESXi ${file.esxi_version || ''} 官方原版安装镜像` : `ESXi ${file.esxi_version || ''} 官方标准离线包`,
    cleanVersion: file.esxi_version,
    badgeLabel: isIso ? '官方 ISO' : '官方离线包',
    badgeColor: 'blue',
  }
}
