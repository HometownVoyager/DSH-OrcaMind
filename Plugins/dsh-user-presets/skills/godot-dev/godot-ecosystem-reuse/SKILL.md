---
name: godot-ecosystem-reuse
description: "生态借力 资源复用 拒绝重复造轮子 开源插件 Awesome-Godot AssetLib web_search 二阶弹簧 交互组件 对象池 伤害契约 组件化架构 common_components 适配器模式 —— 当你编写新功能、实现复杂系统、添加载具武器、避免从零手写低幼代码时使用"
---

# Godot 生态借力与资源复用行动守则 (godot-ecosystem-reuse)

消除 AI 编码中“闭门造车、手写低幼逻辑、重复造轮子”的顽疾，确立**“能原生不伪实现、能组件不手写、能插件不生造”**的工业级研发工程准则。

**何时使用**：编写任何新功能、重构旧系统、实现角色武器/载具/AI/运镜机制之前。

---

## 一、编码前强制五步检视门禁 (Pre-Flight Check)

在动笔写任何业务逻辑前，必须逐项核对并执行：

```
[步骤 1: 查引擎原生] ──► Godot 4 内置节点或全局数学库能否直接解决？
                           │ (Timer / Tween / VisibleOnScreenNotifier3D / NavigationAgent3D)
                           ▼
[步骤 2: 查项目内部] ──► 项目内是否有现成单例、工具类或通用组件？
                           │ (EventBus / GlobalConfig / AudioMgr / common_components)
                           ▼
[步骤 3: 查开源生态] ──► 需求是否为通用复杂系统 (≥100行)？
                           │ 必须执行 web_search 检索 GitHub/AssetLib 高星开源方案
                           ▼
[步骤 4: 选组件/插件] ──► 优先挂载通用组件或引入插件，严禁从零手写脆弱逻辑
                           │ (通过 Adapter 防腐层封装)
                           ▼
[步骤 5: 强类型门禁] ──► 遵循 Godot 4.7.2 强静态类型规范，交付前必跑 script_patch 校验（零 parse error）+ test_run
```

---

## 二、通用高效组件资产库 (`addons/common_components`)

项目已内置工业级通用轻量组件库（纯 GDScript 4.7 静态强类型，零外部依赖），**严禁绕过组件手写简陋替代品**：

| 组件名 | 适用场景 | 严禁的反模式 | 强制规范 |
| :--- | :--- | :--- | :--- |
| **`SpringDamperComponent3D`** | 武器后坐力、相机晃动、走动颠簸 (Head Bob)、悬挂位移 | 严禁手写线性 `lerp` 或简单三角函数伪装后坐力 | 使用二阶弹簧阻尼微分方程，配置 `frequency` 与 `damping_ratio`，通过 `impulse()` 注入冲击 |
| **`InteractableComponent3D`** | 载具上车、固定武器操控、补给箱、门禁交互 | 严禁在角色代码中硬编码 `col.has_method("interact")` | 目标实体挂载本组件，角色通过 `can_interact()` / `interact()` 统一契约分发 |
| **`NodePool3D`** | 高频弹丸 (Projectile)、弹壳掉落、枪口火光、击中火星 | 严禁在主循环中频繁 `instantiate()` 和 `queue_free()` | 预热循环队列，通过 `acquire()` / `recycle()` 重复利用实例，杜绝 GC 掉帧 |
| **`HurtboxComponent3D`** | 部位承伤 (爆头/四肢/车体)、载具殉爆乘员结算 | 严禁随手少传参数调用 `take_damage(a, b)` | 强制统一 4 参数强类型伤害契约：`(amount, attacker, is_head, weapon_name)` |
| **`ArmorBallisticsMath`** | 坦克/步兵战车跳弹、入射角倾角结算、等效装甲厚度 | 严禁写死固定百分比减伤 `if is_tank: dmg *= 0.5` | 调用 `calculate_effective_armor()` 与 `is_ricochet()` 进行物理几何结算 |

---

## 三、网络搜索与开源插件引入流程

当遇到**超出 100 行的通用复杂系统**（如运镜系统、分层状态图、行为树、复杂着色器、音效管理器）时，**必须执行生态调研**：

### 1. 检索指令标准
调用 `web_search` 检索：
- 运镜相机：`"Godot 4" "phantom-camera" github`
- 分层状态机：`"Godot 4" "state-charts" github`
- 行为树/效用AI：`"Godot 4" "limboai" OR "beehave" github`
- 综合开源目录：`"awesome-godot" github` 或 Godot Asset Library

### 2. 准入审计清单
- [ ] 兼容 Godot 4.3+ / 4.7+；
- [ ] 纯 GDScript 优先（跨平台零编译负担）；
- [ ] 源码无恶意/混淆代码，架构清晰。

### 3. 安装与注册规范
- 将插件解压并放置在项目 `addons/<plugin_name>/`；
- 在 `project.godot` 中的 `[editor_plugins]` 注册：
  ```ini
  [editor_plugins]
  enabled=PackedStringArray("res://addons/godot_ai/plugin.cfg", "res://addons/<plugin_name>/plugin.cfg")
  ```

### 4. Adapter 适配器防腐层隔离
**严禁业务代码与第三方插件类直接强耦合**。必须编写一个轻量 Adapter 包装类（例如用 `CameraController.gd` 包装第三方 `PhantomCamera3D`）。当第三方插件升级或被替换时，业务代码零修改。

---

## 四、榨取 Godot 原生复合节点能力

能用引擎底层 C++ 原生节点实现的功能，绝对不要用 GDScript 重复造轮子：

1. **定时逻辑**：使用 `Timer` 节点或 `get_tree().create_timer(sec).timeout`，杜绝在 `_process` 里手动累加 `timer += delta`。
2. **缓动补间**：使用 `create_tween().set_trans(...).set_ease(...)`，杜绝手动插值。
3. **屏幕外剔除**：使用 `VisibleOnScreenNotifier3D` 控制动画、特效和高耗物理的休眠与激活。
4. **射线与物理探测**：静态挂载 `RayCast3D` / `ShapeCast3D`，避免频繁手写开销高昂的 `direct_space_state.intersect_ray`。
5. **寻路与避障**：使用 `NavigationAgent3D`，直接利用引擎内置 RVO 避障，杜绝手写简陋寻路。
