# -*- coding: utf-8 -*-
# 检查 MobileNetV2 ONNX 模型的输入输出和层结构，确定特征提取层
import cv2

net = cv2.dnn.readNetFromONNX('models/mobilenetv2-7.onnx')

# 获取所有层的名称和类型
layers = net.getLayerNames()
print('层总数:', len(layers))

# 找到输入/输出层
print('\n输入层:')
# cv2.dnn 的 getLayerNames 返回索引，需要用 getLayer
# 直接打印最后几层（通常最后几层是 GAP / FC / softmax）
for name in layers[-8:]:
    try:
        lid = net.getLayerId(name)
        print(' ', lid, name)
    except Exception as e:
        print(' ', name, 'ERR', e)

# 尝试获取 unconnected output layers（输出层名）
try:
    out_names = net.getUnconnectedOutLayersNames()
    print('\n输出层:', out_names)
except Exception as e:
    print('\n输出层获取失败:', e)

# 尝试 forward 一次，看输出形状
import numpy as np
blob = cv2.dnn.blobFromImage(np.zeros((224,224,3), np.uint8), 1/255.0, (224,224), (0.485,0.456,0.406), swapRB=True)
net.setInput(blob)
out = net.forward()
print('\n最终输出形状:', out.shape)
