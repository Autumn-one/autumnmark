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
        :key="method.label"
        class="payment-option"
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
  { label: 'remoteContent.donation.alipay', image: alipayQr },
  { label: 'remoteContent.donation.wechatPay', image: wechatPayQr }
]
</script>

<style scoped>
.announcement-donation {
  min-width: 0;
  border: 1px solid color-mix(in srgb, #ca7848 27%, var(--floatBgColor));
  border-radius: 10px;
  padding: 12px;
  background: color-mix(in srgb, #ca7848 7%, var(--floatBgColor));
}

.announcement-donation h3 {
  margin: 0 0 4px;
  color: var(--editorColor80);
  font-size: 15px;
  font-weight: 650;
}

.announcement-donation p {
  margin: 0 0 12px;
  color: var(--floatFontColor);
  font-size: 12px;
  line-height: 1.5;
}

.payment-options {
  display: grid;
  justify-items: center;
  gap: 12px;
}

.payment-option {
  width: min(100%, 144px);
  margin: 0;
  text-align: center;
}

.payment-option + .payment-option {
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 12px;
}

.payment-option img {
  box-sizing: border-box;
  display: block;
  width: min(100%, 124px);
  aspect-ratio: 1;
  object-fit: contain;
  margin: 0 auto;
  border: 1px solid var(--floatBorderColor);
  border-radius: 5px;
  padding: 3px;
  background: #fff;
}

.payment-option figcaption {
  margin-top: 5px;
  color: var(--editorColor80);
  font-size: 12px;
  font-weight: 600;
}
</style>
