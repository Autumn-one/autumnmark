<template>
  <section
    class="announcement-donation"
    :aria-labelledby="titleId"
  >
    <h3 :id="titleId">
      {{ t('remoteContent.donation.title') }}
    </h3>
    <p>{{ t('remoteContent.donation.description') }}</p>
    <div class="payment-options">
      <figure
        v-for="method in paymentMethods"
        :key="method.name"
        class="payment-option"
        :class="method.name"
      >
        <img
          :src="method.image"
          :alt="t('remoteContent.donation.qrCode', { method: t(method.label) })"
        >
        <figcaption>{{ t(method.label) }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import alipayQr from '@/assets/images/donation-alipay.jpg'
import wechatPayQr from '@/assets/images/donation-wechat-pay.png'

const { t } = useI18n()
const titleId = useId()
const paymentMethods = [
  { name: 'alipay', label: 'remoteContent.donation.alipay', image: alipayQr },
  { name: 'wechat-pay', label: 'remoteContent.donation.wechatPay', image: wechatPayQr }
]
</script>

<style scoped>
.announcement-donation {
  border: 1px solid color-mix(in srgb, #ca7848 27%, var(--floatBgColor));
  border-radius: 12px;
  padding: clamp(14px, 4vw, 22px);
  background: color-mix(in srgb, #ca7848 7%, var(--floatBgColor));
}

.announcement-donation h3 {
  margin: 0 0 4px;
  color: var(--editorColor80);
  font-size: 16px;
  font-weight: 650;
}

.announcement-donation p {
  margin: 0 0 14px;
  color: var(--floatFontColor);
  font-size: 13px;
  line-height: 1.5;
}

.payment-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 162px), 1fr));
  gap: 12px;
}

.payment-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--payment-accent) 24%, var(--floatBgColor));
  border-radius: 10px;
  padding: 12px;
  background: color-mix(in srgb, var(--payment-accent) 6%, var(--floatBgColor));
}

.alipay {
  --payment-accent: #1677ff;
}

.wechat-pay {
  --payment-accent: #07a85a;
}

.payment-option img {
  box-sizing: border-box;
  display: block;
  width: min(100%, 190px);
  aspect-ratio: 1;
  border-radius: 5px;
  padding: 10px;
  background: #fff;
}

.payment-option figcaption {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--editorColor80);
  font-size: 13px;
  font-weight: 600;
}

.payment-option figcaption::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--payment-accent);
  content: '';
}
</style>
