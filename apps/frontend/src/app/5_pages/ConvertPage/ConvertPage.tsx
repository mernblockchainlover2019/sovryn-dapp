import React, { FC, useCallback, useMemo, useState } from 'react';
import { useEffect } from 'react';

import { t } from 'i18next';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';

import { getAssetData } from '@sovryn/contracts';
import { ChainId } from '@sovryn/ethers-provider';
import { getProvider } from '@sovryn/ethers-provider';
import { SwapRoute } from '@sovryn/sdk';
import { SmartRouter } from '@sovryn/sdk';
import {
  Accordion,
  AmountInput,
  applyDataAttr,
  Button,
  ButtonStyle,
  ButtonType,
  ErrorBadge,
  ErrorLevel,
  Heading,
  Icon,
  IconNames,
  Paragraph,
  ParagraphSize,
  Select,
  SelectOption,
  SimpleTable,
  SimpleTableRow,
  TooltipTrigger,
} from '@sovryn/ui';
import { Decimal } from '@sovryn/utils';

import { AmountRenderer } from '../../2_molecules/AmountRenderer/AmountRenderer';
import { AssetRenderer } from '../../2_molecules/AssetRenderer/AssetRenderer';
import { MaxButton } from '../../2_molecules/MaxButton/MaxButton';
import { TOKEN_RENDER_PRECISION } from '../../../constants/currencies';
import { getTokenDisplayName } from '../../../constants/tokens';
import { useAccount } from '../../../hooks/useAccount';
import { useAssetBalance } from '../../../hooks/useAssetBalance';
import { useCurrentChain } from '../../../hooks/useChainStore';
import { useWeiAmountInput } from '../../../hooks/useWeiAmountInput';
import { translations } from '../../../locales/i18n';
import { COMMON_SYMBOLS, listAssetsOfChain } from '../../../utils/asset';
import { removeTrailingZerosFromString } from '../../../utils/helpers';
import { decimalic, fromWei } from '../../../utils/math';
import { FIXED_MYNT_RATE, FIXED_RATE_ROUTES } from './ConvertPage.constants';
import {
  DEFAULT_SWAP_ENTRIES,
  SMART_ROUTER_STABLECOINS,
  SWAP_ROUTES,
} from './ConvertPage.constants';
import { useConversionMaintenance } from './hooks/useConversionMaintenance';
import { useGetMaximumAvailableAmount } from './hooks/useGetMaximumAvailableAmount';
import { useHandleConversion } from './hooks/useHandleConversion';

const commonTranslations = translations.common;
const pageTranslations = translations.convertPage;

const MYNT_TOKEN = 'MYNT';

const ConvertPage: FC = () => {
  const currentChainId = useCurrentChain();

  const [hasQuoteError, setHasQuoteError] = useState(false);

  const smartRouter = useMemo(
    () => new SmartRouter(getProvider(currentChainId), SWAP_ROUTES),
    [currentChainId],
  );

  const tokensToOptions = useCallback(
    (
      addresses: string[],
      chain: ChainId,
      callback: (options: SelectOption<string>[]) => void,
    ) =>
      Promise.all(
        addresses.map(address => smartRouter.getTokenDetails(address, chain)),
      ).then(tokens =>
        callback(
          tokens.map(token => ({
            value: token.symbol,
            label: (
              <AssetRenderer
                showAssetLogo
                asset={token.symbol}
                chainId={chain}
                assetClassName="font-medium"
              />
            ),
          })),
        ),
      ),
    [smartRouter],
  );

  const { account } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const fromToken = searchParams.get('from') || '';
  const toToken = searchParams.get('to') || '';
  const { balance: myntBalance } = useAssetBalance(MYNT_TOKEN);

  const [slippageTolerance, setSlippageTolerance] = useState('0.5');

  const [priceInQuote, setPriceQuote] = useState(false);
  const hasMyntBalance = useMemo(() => myntBalance.gt(0), [myntBalance]);
  const [amount, setAmount, weiAmount] = useWeiAmountInput('');

  const [quote, setQuote] = useState('');
  const [route, setRoute] = useState<SwapRoute | undefined>();

  const defaultSourceToken = useMemo(() => {
    if (fromToken) {
      const item = listAssetsOfChain(currentChainId).find(
        item => item.symbol.toLowerCase() === fromToken.toLowerCase(),
      );

      if (item) {
        return item.symbol;
      }
    }
    return DEFAULT_SWAP_ENTRIES[currentChainId] ?? COMMON_SYMBOLS.ETH;
  }, [currentChainId, fromToken]);

  const [sourceToken, setSourceToken] = useState<string>(defaultSourceToken);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const [tokenOptions, setTokenOptions] = useState<SelectOption<string>[]>([]);

  const [destinationTokenOptions, setDestinationTokenOptions] = useState<
    SelectOption<string>[]
  >([]);

  useEffect(() => {
    const newToken = DEFAULT_SWAP_ENTRIES[currentChainId];
    if (!!newToken) {
      setAmount('');
      setSourceToken(newToken);
    }
  }, [currentChainId, setAmount]);

  useEffect(() => {
    smartRouter
      .getEntries(currentChainId)
      .then(tokens => tokensToOptions(tokens, currentChainId, setTokenOptions));
  }, [currentChainId, smartRouter, tokensToOptions]);

  useEffect(() => {
    (async () => {
      const sourceTokenDetails = await getAssetData(
        sourceToken,
        currentChainId,
      );
      smartRouter
        .getDestination(currentChainId, sourceTokenDetails.address)
        .then(tokens => {
          tokensToOptions(tokens, currentChainId, setDestinationTokenOptions);
        });

      if (sourceToken === MYNT_TOKEN) {
        setDestinationToken(COMMON_SYMBOLS.SOV);
      }
    })();
  }, [currentChainId, smartRouter, sourceToken, tokensToOptions]);

  const sourceTokenOptions = useMemo(
    () =>
      hasMyntBalance
        ? tokenOptions
        : tokenOptions.filter(option => option.value !== MYNT_TOKEN),
    [hasMyntBalance, tokenOptions],
  );

  const [destinationToken, setDestinationToken] = useState<string | ''>('');

  const onTransactionSuccess = useCallback(() => setAmount(''), [setAmount]);

  const maximumAmountToConvert = useGetMaximumAvailableAmount(
    sourceToken,
    destinationToken,
  );

  const isValidAmount = useMemo(
    () => Number(amount) <= Number(maximumAmountToConvert),
    [amount, maximumAmountToConvert],
  );

  const isMyntFixRoute = useMemo(
    () => route && route.name === 'MyntFixedRate',
    [route],
  );

  const minimumReceived = useMemo(() => {
    if (!quote || !slippageTolerance || !route) {
      return '';
    }

    if (FIXED_RATE_ROUTES.includes(route.name)) {
      return quote;
    }

    return Decimal.from(quote)
      .mul(100 - Number(slippageTolerance))
      .div(100)
      .toString();
  }, [quote, route, slippageTolerance]);

  const priceToken = useMemo<string>(() => {
    if (!destinationToken) {
      return sourceToken;
    }
    if (
      priceInQuote ||
      SMART_ROUTER_STABLECOINS.find(token => token === destinationToken)
    ) {
      return destinationToken;
    }
    return sourceToken;
  }, [destinationToken, sourceToken, priceInQuote]);

  const price = useMemo(() => {
    if (
      !quote ||
      !minimumReceived ||
      decimalic(quote).isZero() ||
      decimalic(amount).isZero()
    ) {
      return '';
    }

    if (isMyntFixRoute) {
      return FIXED_MYNT_RATE;
    }

    if (priceToken === destinationToken) {
      return decimalic(minimumReceived).div(amount).toString();
    } else {
      return decimalic(amount).div(minimumReceived).toString();
    }
  }, [
    amount,
    destinationToken,
    isMyntFixRoute,
    minimumReceived,
    priceToken,
    quote,
  ]);

  useEffect(() => {
    (async () => {
      setQuote('');
      setRoute(undefined);

      if (!sourceToken || !destinationToken || weiAmount.lte(0)) {
        return;
      }

      try {
        const [sourceTokenDetails, destinationTokenDetails] = await Promise.all(
          [
            getAssetData(sourceToken, currentChainId),
            getAssetData(destinationToken, currentChainId),
          ],
        );

        const result = await smartRouter.getBestQuote(
          currentChainId,
          sourceTokenDetails.address,
          destinationTokenDetails.address,
          weiAmount,
        );

        setRoute(result.route);
        const quote = removeTrailingZerosFromString(
          fromWei(result.quote.toString()),
        );
        setQuote(quote);
        setHasQuoteError(false);
      } catch {
        setHasQuoteError(true);
      }
    })();
  }, [sourceToken, destinationToken, weiAmount, currentChainId, smartRouter]);

  const onMaximumAmountClick = useCallback(
    () => setAmount(maximumAmountToConvert.toString()),
    [maximumAmountToConvert, setAmount],
  );

  const onSwitchClick = useCallback(() => {
    if (destinationToken) {
      setDestinationToken(sourceToken);
      setSourceToken(destinationToken);
      setHasQuoteError(false);
      setAmount('');
    }
    if (destinationToken) {
      setDestinationToken(sourceToken);
      setSourceToken(destinationToken);
      setHasQuoteError(false);
      setAmount('');
    }
  }, [destinationToken, setAmount, sourceToken]);

  const onSourceTokenChange = useCallback(
    (value: string) => {
      setSourceToken(value);
      setHasQuoteError(false);
      setAmount('');
    },
    [setAmount],
  );

  const onDestinationTokenChange = useCallback((value: string) => {
    setDestinationToken(value);
    setHasQuoteError(false);
  }, []);

  const getAssetRenderer = useCallback(
    (token: string) => (
      <AssetRenderer
        showAssetLogo
        asset={token}
        chainId={currentChainId}
        assetClassName="font-medium"
      />
    ),
    [currentChainId],
  );

  const { handleSubmit } = useHandleConversion(
    sourceToken,
    destinationToken,
    weiAmount,
    route,
    slippageTolerance,
    onTransactionSuccess,
  );

  const isInMaintenance = useConversionMaintenance(
    sourceToken,
    destinationToken,
    route,
  );

  const isSubmitDisabled = useMemo(
    () =>
      isInMaintenance ||
      !account ||
      !amount ||
      Number(amount) <= 0 ||
      Number(amount) > Number(maximumAmountToConvert) ||
      !destinationToken ||
      !route,
    [
      isInMaintenance,
      account,
      amount,
      maximumAmountToConvert,
      destinationToken,
      route,
    ],
  );

  const renderDestinationAmount = useMemo(
    () => quote || t(commonTranslations.na),
    [quote],
  );

  const renderPriceAmount = useMemo(() => {
    if (price) {
      return (
        <AmountRenderer
          value={price}
          suffix={getTokenDisplayName(priceToken)}
          precision={TOKEN_RENDER_PRECISION}
          trigger={TooltipTrigger.hover}
        />
      );
    }
    return t(commonTranslations.na);
  }, [price, priceToken]);

  const togglePriceQuote = useCallback(
    () => setPriceQuote(value => !value),
    [],
  );

  useEffect(() => {
    if (fromToken) {
      setSourceToken(fromToken);
    }
    if (toToken) {
      setDestinationToken(toToken);
    }
  }, [fromToken, toToken]);

  useEffect(() => {
    if (hasMyntBalance && fromToken === MYNT_TOKEN) {
      setSourceToken(MYNT_TOKEN);
    } else if (!hasMyntBalance && fromToken === MYNT_TOKEN) {
      setSourceToken(COMMON_SYMBOLS.DLLR);
    }
  }, [hasMyntBalance, fromToken]);

  useEffect(() => {
    const urlParams = new URLSearchParams();

    if (sourceToken) {
      urlParams.set('from', sourceToken);
    } else {
      urlParams.delete('from');
    }

    if (destinationToken) {
      urlParams.set('to', destinationToken);
    } else {
      urlParams.delete('to');
    }

    if (toToken !== destinationToken || fromToken !== sourceToken) {
      setSearchParams(new URLSearchParams(urlParams));
    }
  }, [sourceToken, destinationToken, setSearchParams, toToken, fromToken]);

  useEffect(() => {
    if (!account) {
      setHasQuoteError(false);
      setAmount('');
    }
  }, [account, setAmount]);

  return (
    <>
      <Helmet>
        <title>{t(pageTranslations.meta.title)}</title>
      </Helmet>
      <div className="w-full flex flex-col items-center text-gray-10 mt-9 sm:mt-24">
        <Heading className="text-base sm:text-2xl font-medium">
          {t(pageTranslations.title)}
        </Heading>
        <Paragraph
          size={ParagraphSize.base}
          className="mt-2.5 sm:mt-4 sm:text-base font-medium"
        >
          {t(pageTranslations.subtitle)}
        </Paragraph>

        <div className="mt-12 w-full p-0 sm:border sm:border-gray-50 sm:rounded sm:w-[28rem] sm:p-6 sm:bg-gray-90">
          <div className="bg-gray-80 rounded p-6">
            <div className="w-full flex flex-row justify-between items-center">
              <Paragraph size={ParagraphSize.base} className="font-medium">
                {t(pageTranslations.form.convertFrom)}
              </Paragraph>

              <MaxButton
                onClick={onMaximumAmountClick}
                value={maximumAmountToConvert}
                token={sourceToken}
                dataAttribute="convert-from-max"
                chainId={currentChainId}
              />
            </div>

            <div className="w-full flex flex-row justify-between items-center gap-3 mt-3.5">
              <AmountInput
                value={amount}
                onChangeText={setAmount}
                label={t(commonTranslations.amount)}
                min={0}
                invalid={!isValidAmount}
                disabled={!account}
                className="w-full flex-grow-0 flex-shrink"
                dataAttribute="convert-from-amount"
                placeholder="0"
              />

              <Select
                value={sourceToken}
                onChange={onSourceTokenChange}
                options={sourceTokenOptions}
                labelRenderer={() => getAssetRenderer(sourceToken)}
                className="min-w-[6.7rem]"
                menuClassName="max-h-[10rem] sm:max-h-[20rem]"
                dataAttribute="convert-from-asset"
              />
            </div>

            {!isValidAmount && (
              <ErrorBadge
                level={ErrorLevel.Critical}
                message={t(pageTranslations.form.invalidAmountError)}
                dataAttribute="convert-from-amount-error"
              />
            )}
          </div>

          <div className="flex justify-center rounded-full -mt-3.5">
            <button
              className="w-11 h-11 rounded-full bg-gray-90 flex justify-center items-center"
              onClick={onSwitchClick}
              {...applyDataAttr('convert-swap-asset')}
            >
              <Icon
                icon={IconNames.PENDING}
                className="text-gray-50 rotate-90"
                size={24}
              />
            </button>
          </div>

          <div className="bg-gray-80 rounded p-6 -mt-3.5">
            <Paragraph size={ParagraphSize.base} className="font-medium">
              {t(pageTranslations.form.convertTo)}
            </Paragraph>

            <div className="w-full flex flex-row justify-between items-center gap-3 mt-3.5">
              <AmountInput
                value={renderDestinationAmount}
                label={t(commonTranslations.amount)}
                readOnly
                placeholder={t(commonTranslations.na)}
                className="w-full flex-grow-0 flex-shrink"
                dataAttribute="convert-to-amount"
              />
              <Select
                value={destinationToken}
                onChange={onDestinationTokenChange}
                options={destinationTokenOptions}
                className="min-w-[6.7rem]"
                menuClassName="max-h-[10rem] sm:max-h-[20rem]"
                dataAttribute="convert-to-asset"
              />
            </div>
          </div>

          {
            sourceToken && destinationToken && quote ? (
              <>
                <Accordion
                  className="mt-4 mb-3 text-xs"
                  label={t(translations.common.advancedSettings)}
                  open={showAdvancedSettings}
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  dataAttribute="convert-settings"
                >
                  <div className="mt-2 mb-4">
                    <AmountInput
                      value={slippageTolerance}
                      onChange={e => setSlippageTolerance(e.target.value)}
                      label={t(pageTranslations.slippageTolerance)}
                      className="max-w-none w-full"
                      unit="%"
                      step="0.01"
                      decimalPrecision={2}
                      placeholder="0"
                      max="100"
                    />
                  </div>
                </Accordion>

                <SimpleTable className="mt-3">
                  <SimpleTableRow
                    label={t(pageTranslations.minimumReceived)}
                    valueClassName="text-primary-10"
                    value={
                      <AmountRenderer
                        value={minimumReceived}
                        suffix={getTokenDisplayName(destinationToken)}
                        precision={TOKEN_RENDER_PRECISION}
                      />
                    }
                  />
                  <SimpleTableRow
                    label={t(pageTranslations.maximumPrice)}
                    valueClassName="text-primary-10"
                    className="cursor-pointer"
                    onClick={togglePriceQuote}
                    value={renderPriceAmount}
                  />
                </SimpleTable>
              </>
            ) : null
            // <SimpleTable className="mt-3">
            //   <SimpleTableRow
            //     label={t(pageTranslations.price)}
            //     valueClassName="text-primary-10"
            //     className="cursor-pointer"
            //     value={renderPriceAmount}
            //     onClick={() => setPriceQuote(value => !value)}
            //   />
            // </SimpleTable>
          }

          {hasQuoteError && (
            <ErrorBadge
              level={ErrorLevel.Critical}
              message={t(pageTranslations.form.quoteError)}
              dataAttribute="convert-quote-error"
            />
          )}

          <Button
            type={ButtonType.reset}
            style={ButtonStyle.primary}
            text={t(commonTranslations.buttons.confirm)}
            className="w-full mt-8"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
            dataAttribute="convert-confirm"
          />

          {isInMaintenance && (
            <ErrorBadge
              level={ErrorLevel.Warning}
              message={t(translations.maintenanceMode.featureDisabled)}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default ConvertPage;
