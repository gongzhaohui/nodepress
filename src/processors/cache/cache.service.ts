/**
 * Cache service.
 * @file Cache 缓存模块服务
 * @module processor/cache/service
 * @author Surmon <https://github.com/surmon-china>
 */

import * as schedule from 'node-schedule';
import { CACHE_MANAGER, Inject, Injectable } from '@nestjs/common';

export type TCacheKey = string;
export type TCacheResult<T> = Promise<T>;

// Cache 客户端管理器
export interface ICacheManager {
  store: any;
  get(key: TCacheKey): any;
  set(key: TCacheKey, value: string, options?: { ttl: number }): any;
}

// Promise 模式参数
export interface ICachePromiseOption<T> {
  key: TCacheKey;
  promise(): TCacheResult<T>;
}

// Promise & IO 模式参数
export interface ICachePromiseIoOption<T> extends ICachePromiseOption<T> {
  ioMode?: boolean;
}

// Promise & IO 模式返回结构
export interface TCachePromiseIoResult<T> {
  get(): TCacheResult<T>;
  update(): TCacheResult<T>;
}

// Interval & Timeout 超时模式参数
export interface ICacheIntervalTimeoutOption {
  error?: number;
  success?: number;
}

// Interval & Timing 定时模式参数
export interface ICacheIntervalTimingOption {
  error: number;
  schedule: any;
}

// Interval 模式参数
export interface ICacheIntervalOption<T> {
  key: TCacheKey;
  promise(): TCacheResult<T>;
  timeout?: ICacheIntervalTimeoutOption;
  timing?: ICacheIntervalTimingOption;
}

// Interval 模式返回类型
export type ICacheIntervalResult<T> = () => TCacheResult<T>;

/**
 * @class CacheService
 * @classdesc 承载缓存服务
 * @example CacheService.get(CacheKey).then()
 * @example CacheService.set(CacheKey).then()
 * @example CacheService.promise({ option })()
 * @example CacheService.interval({ option })()
 */
@Injectable()
export class CacheService {

  private cache!: ICacheManager;

  constructor(@Inject(CACHE_MANAGER) cache: ICacheManager) {
    this.cache = cache;
  }

  // 客户端是否可用
  private get checkCacheServiceAvailable(): boolean {
    const client = this.cache.store.getClient();
    return client.connected && client.ready;
  }

  public get<T>(key: TCacheKey): TCacheResult<T> {
    if (!this.checkCacheServiceAvailable) {
      return Promise.reject('缓存客户端没准备好');
    }
    return this.cache.get(key);
  }

  public set<T>(key: TCacheKey, value: any, options?: { ttl: number }): TCacheResult<T> {
    if (!this.checkCacheServiceAvailable) {
      return Promise.reject('缓存客户端没准备好');
    }
    return this.cache.set(key, value, options);
  }

  /**
   * @function promise
   * @description 被动更新 | 双向同步 模式，Promise -> Redis
   * @example CacheService.promise({ key: CacheKey, promise() }) -> promise()
   * @example CacheService.promise({ key: CacheKey, promise(), ioMode: true }) -> { get: promise(), update: promise() }
   */
  promise<T>(options: ICachePromiseOption<T>): TCacheResult<T>;
  promise<T>(options: ICachePromiseIoOption<T>): TCachePromiseIoResult<T>;
  promise(options) {

    const { key, promise, ioMode = false } = options;

    // 执行任务
    const doPromise = (resolve, reject) => {
      return promise().then(data => {
        this.set(key, data);
        resolve(data);
      }).catch(reject);
    };

    // Promise 拦截模式（返回死数据）
    const handlePromiseMode = () => {
      return new Promise((resolve, reject) => {
        this.get(key).then(value => {
          const isValidValue = value !== null && value !== undefined;
          isValidValue ? resolve(value) : doPromise(resolve, reject);
        }).catch(reject);
      });
    };

    // 双向同步模式（返回获取器和更新器）
    const handleIoMode = () => ({
      get: handlePromiseMode,
      update: () => new Promise(doPromise),
    });

    return ioMode ? handleIoMode() : handlePromiseMode();
  }

  /**
   * @function interval
   * @description 定时 | 超时 模式，Promise -> Task -> Redis
   * @example CacheService.interval({ key: CacheKey, promise(), timeout: {} }) -> promise()
   * @example CacheService.interval({ key: CacheKey, promise(), timing: {} }) -> promise()
   */
  public interval<T>(options: ICacheIntervalOption<T>): ICacheIntervalResult<T> {

    const { key, promise, timeout, timing } = options;

    // 超时任务
    if (timeout) {
      const promiseTask = () => {
        promise().then(data => {
          this.set(key, data);
          setTimeout(promiseTask, timeout.success);
        }).catch(error => {
          const time = timeout.error || timeout.success;
          setTimeout(promiseTask, time);
          console.warn(`Redis 超时任务执行失败，${time} 后重试：${error}`);
        });
      };
      promiseTask();
    }

    // 定时任务
    if (timing) {
      const promiseTask = () => {
        promise()
          .then(data => this.set(key, data))
          .catch(error => {
            console.warn(`Redis 定时任务执行失败，${timing.error} 后重试：${error}`);
            setTimeout(promiseTask, timing.error);
          });
      };
      promiseTask();
      schedule.scheduleJob(timing.schedule, promiseTask);
    }

    // 返回 Redis 获取器
    return () => this.get(key);
  }
}
