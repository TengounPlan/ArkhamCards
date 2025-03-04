import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Platform,
  View,
  Text,
} from 'react-native';
import { Navigation } from 'react-native-navigation';
import { ScrollView } from 'react-native-gesture-handler';
import SnapCarousel from 'react-native-snap-carousel';
import Animated from 'react-native-reanimated';
import { useSelector } from 'react-redux';
import { msgid, ngettext, t } from 'ttag';
import { find, flatMap, filter, map, slice, sortBy, sumBy } from 'lodash';

import CardDetailComponent from './CardDetailView/CardDetailComponent';
import { rightButtonsForCard } from './CardDetailView';
import { CardFaqProps } from './CardFaqView';
import { makeTabooSetSelector, AppState, getPackSpoilers, getPacksInCollection } from '@reducers';
import { InvestigatorCardsProps } from '../cardlist/InvestigatorCardsView';
import { NavigationProps } from '@components/nav/types';
import Card from '@data/types/Card';
import COLORS from '@styles/colors';
import StyleContext from '@styles/StyleContext';
import { useToggles, useComponentDidAppear, useNavigationButtonPressed, useCards, useSettingValue } from '@components/core/hooks';
import DatabaseContext from '@data/sqlite/DatabaseContext';
import { where } from '@data/sqlite/query';
import { FOOTER_HEIGHT, PreLoadedDeckNavFooter } from '@components/deck/DeckNavFooter';
import { FactionCodeType } from '@app_constants';
import FloatingDeckQuantityComponent from '@components/cardlist/CardSearchResult/ControlComponent/FloatingDeckQuantityComponent';
import { AttachableDefinition, Customizations, DeckId } from '@actions/types';
import { CardInvestigatorProps } from './CardInvestigatorsView';
import CardCustomizationOptions from './CardDetailView/CardCustomizationOptions';
import { useCardCustomizations, useDeckAttachmentSlots, useParsedDeck } from '@components/deck/hooks';
import { CustomizationChoice } from '@data/types/CustomizationOption';
import LanguageContext from '@lib/i18n/LanguageContext';
import { getArkhamDbDomain } from '@lib/i18n/LanguageProvider';
import { getSystemLanguage } from '@lib/i18n';
import { useAttachableCards, useDeckAttachments } from '@components/deck/useParsedDeckComponent';
import RoundedFactionBlock from '@components/core/RoundedFactionBlock';
import RoundedFactionHeader from '@components/core/RoundedFactionHeader';
import space, { s } from '@styles/space';
import CardSearchResult from '@components/cardlist/CardSearchResult';

export interface CardDetailSwipeProps {
  cardCodes: string[];
  controls?: ('deck' | 'side' | 'extra' | 'special' | 'ignore' | 'bonded' | 'checklist' | 'attachment')[];
  initialCards?: Card[];
  initialIndex: number;
  whiteNav: boolean;
  showAllSpoilers?: boolean;
  tabooSetId?: number;
  deckId?: DeckId;
  faction?: FactionCodeType;
  editable?: boolean;
  customizationsEditable?: boolean;
  initialCustomizations: Customizations | undefined
}

type Props = NavigationProps & CardDetailSwipeProps;

const options = (passProps: CardDetailSwipeProps) => {
  return {
    topBar: {
      backButton: {
        title: t`Back`,
        color: passProps.whiteNav ? 'white' : COLORS.M,
      },
    },
  };
};

const NO_CUSTOMIZATIONS: CustomizationChoice[] = [];

function AttachmentSection({ card, deckId, attachment, attachmentCards, width }: { width: number; card: Card, deckId: DeckId; attachment: AttachableDefinition; attachmentCards: Card[] }) {
  const { typography } = useContext(StyleContext);
  const sorted = useMemo(() => sortBy(attachmentCards, a => a.name), [attachmentCards]);
  const slots = useDeckAttachmentSlots(deckId, attachment);
  const total = useMemo(() => sumBy(Object.values(slots), c => c), [slots]);
  const errorMessage = useMemo(() => {
    if (total > attachment.targetSize) {
      return t`Too many selected`;
    }
    const limit = attachment.limit;
    if (limit) {
      let too_many_by_name = false;
      Object.keys(slots).forEach((code) => {
        const count = slots[code];
        if (count > limit) {
          too_many_by_name = true;
          return;
        }
        const card = find(attachmentCards, c => c.code === code);
        const allNamedCards = filter(attachmentCards, c => c.name === card?.name);
        const totalByName = sumBy(allNamedCards, c => {
          return c ? slots[c.code] : 0;
        });
        if (totalByName > limit) {
          too_many_by_name = true;
          return;
        }
      });
      if (too_many_by_name) {
        if (limit === 1) {
          return t`Each card must be different`
        }
        return ngettext(
          msgid`Limit of ${limit} card`,
          `Limit of ${limit} cards`,
          limit
        );
      }
    }
    return undefined;
  }, [total, slots, attachment, attachmentCards])
  return (
    <View style={space.paddingSideS}>
      <RoundedFactionBlock faction={card.factionCode()} header={
        <RoundedFactionHeader
          width={width - s * 2}
          faction={card.factionCode()}
        >
          <View style={[space.paddingSideS, { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Text style={[typography.cardName, { color: '#FFFFFF', flex: 1 }]}>
              {attachment.name}
            </Text>
            <View>
              <Text style={[typography.right, typography.small, { color: '#FFFFFF' }]}>
                { t`${total} of ${attachment.targetSize}` }
              </Text>
              { !!errorMessage && (
                <Text style={[typography.right, typography.small, { color: '#FFFFFF' }]}>
                  { errorMessage }
                </Text>
              )}
            </View>
          </View>
        </RoundedFactionHeader>
      }>
        { map(sorted, (c, idx) => (
          <CardSearchResult key={c.code} noSidePadding noBorder={idx === sorted.length - 1} card={c} control={{ type: 'attachment', deckId, attachment }} />
        ))}
      </RoundedFactionBlock>
    </View>
  );
}

function ScrollableCard(props: {
  componentId: string;
  card: Card | undefined;
  tabooSetId: number | undefined;
  customizationsEditable: boolean | undefined;
  setChoice: (code: string, choice: CustomizationChoice) => void;
  width: number;
  height: number;
  deckId: DeckId | undefined;
  deckCount?: number;
  customizations: Customizations;
  showCardSpoiler: (card: Card) => boolean;
  toggleShowSpoilers: (code: string) => void;
  showInvestigatorCards: (code: string) => void;
  mode?: 'view' | 'edit' | 'upgrade';
  attachment?: AttachableDefinition;
  attachmentCards: Card[];
}) {
  const {
    componentId, mode, customizationsEditable, card, tabooSetId,
    width, height, deckId, customizations, deckCount,
    attachment, attachmentCards,
    setChoice, toggleShowSpoilers, showInvestigatorCards, showCardSpoiler,
  } = props;
  const { backgroundStyle, colors } = useContext(StyleContext);
  const { listSeperator } = useContext(LanguageContext);
  const customizationChoices: CustomizationChoice[] | undefined = useMemo(() => {
    if (card && deckId) {
      if (deckCount) {
        if (customizations[card.code]) {
          return customizations[card.code];
        }
        return flatMap(card.customization_options, (option, idx) => {
          if (option.xp === 0) {
            return card.customizationChoice(idx, 0, undefined, undefined) || [];
          }
          return [];
        })
      }
      return NO_CUSTOMIZATIONS;
    }
    return undefined;
  }, [deckId, customizations, card, deckCount]);
  const customizedCard = useMemo(() => {
    return card?.withCustomizations(listSeperator, customizationChoices);
  }, [card, listSeperator, customizationChoices]);
  if (!customizedCard) {
    return (
      <View style={[styles.wrapper, backgroundStyle, { width, height, justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.lightText} size="small" animating />
      </View>
    );
  }
  return (
    <ScrollView
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      bounces={false}
      contentContainerStyle={backgroundStyle}
    >
      <CardDetailComponent
        componentId={componentId}
        card={customizedCard}
        showSpoilers={showCardSpoiler(customizedCard)}
        toggleShowSpoilers={toggleShowSpoilers}
        showInvestigatorCards={showInvestigatorCards}
        width={width}
        tabooSetId={tabooSetId}
      />
      { !!customizedCard.customization_options && !!card && (
        <CardCustomizationOptions
          componentId={componentId}
          card={card}
          mode={mode}
          deckId={deckId}
          customizationOptions={customizedCard.customization_options}
          customizationChoices={customizationChoices}
          width={width}
          editable={!!customizationsEditable && !!deckCount}
          setChoice={setChoice}
        />
      ) }
      { !!card && !!deckId && !!attachment && (
        <AttachmentSection
          card={card}
          width={width}
          deckId={deckId}
          attachment={attachment}
          attachmentCards={attachmentCards}
        />
      )}
      { deckId !== undefined && <View style={{ width, height: FOOTER_HEIGHT }} /> }
    </ScrollView>
  );
}

function DbCardDetailSwipeView(props: Props) {
  // eslint-disable-next-line react/prop-types
  const { componentId, cardCodes, editable, customizationsEditable, initialCards, showAllSpoilers, deckId, tabooSetId: tabooSetOverride, initialIndex, controls, initialCustomizations } = props;
  const { listSeperator } = useContext(LanguageContext);
  const [customizations, setChoice] = useCardCustomizations(deckId, initialCustomizations);
  const parsedDeck = useParsedDeck(deckId, componentId);
  const deckEdits = parsedDeck?.deckEdits;
  const { backgroundStyle, width, height } = useContext(StyleContext);
  const { db } = useContext(DatabaseContext);
  const tabooSetSelector: (state: AppState, tabooSetOverride?: number) => number | undefined = useMemo(makeTabooSetSelector, []);
  const tabooSetId = useSelector((state: AppState) => tabooSetSelector(state, tabooSetOverride));
  const packInCollection = useSelector(getPacksInCollection);
  const ignore_collection = useSettingValue('ignore_collection');
  const showSpoilers = useSelector(getPackSpoilers);
  const [spoilers, toggleShowSpoilers] = useToggles({});
  const [index, setIndex] = useState(initialIndex);
  const [cards, updateCards] = useCards('code', initialCards);
  const [currentCode, currentControl] = useMemo(() => {
    return [
      cardCodes[index],
      controls ? controls[index] : undefined,
    ];
  }, [cardCodes, controls, index]);

  const currentCard = useMemo(() => {
    const card = cards[currentCode];
    return card && card.withCustomizations(listSeperator, customizations[currentCode]);
  }, [listSeperator, customizations, currentCode, cards]);
  useEffect(() => {
    const nearbyCards = slice(cardCodes, Math.max(index - 10, 0), Math.min(index + 10, cardCodes.length - 1));
    if (find(nearbyCards, code => !cards[code])) {
      const codes = filter(
        slice(cardCodes, Math.max(index - 20, 0), Math.min(index + 30, cardCodes.length - 1)),
        code => !cards[code]
      );
      db.getCards(where(`c.code IN (:...codes)`, { codes }), tabooSetId)
        .then(newCards => {
          updateCards({ type: 'cards', cards: newCards });
        }, console.log);
    }
  }, [index, cardCodes, db, cards, tabooSetId, updateCards]);

  useEffect(() => {
    if (currentCard) {
      const buttonColor = props.whiteNav ? 'white' : COLORS.M;
      const rightButtons = rightButtonsForCard(currentCard, buttonColor);
      Navigation.mergeOptions(componentId, {
        topBar: {
          rightButtons,
          backButton: {
            title: t`Back`,
            color: buttonColor,
          },
        },
      });
    }
  }, [currentCard, componentId, props.whiteNav]);

  const showInvestigatorCards = useCallback((code: string) => {
    Navigation.push<InvestigatorCardsProps>(componentId, {
      component: {
        name: 'Browse.InvestigatorCards',
        passProps: {
          investigatorCode: code,
        },
        options: {
          topBar: {
            title: {
              text: t`Allowed Cards`,
            },
            backButton: {
              title: t`Back`,
            },
          },
        },
      },
    });
  }, [componentId]);

  const showInvestigators = useCallback((code: string) => {
    Navigation.push<CardInvestigatorProps>(componentId, {
      component: {
        name: 'Card.Investigators',
        passProps: {
          code,
        },
        options: {
          topBar: {
            title: {
              text: t`Investigators`,
            },
            backButton: {
              title: t`Back`,
            },
          },
        },
      },
    });
  }, [componentId]);
  const backPressed = useCallback(() => {
    Navigation.pop(componentId);
  }, [componentId]);
  useComponentDidAppear(() => {
    Navigation.mergeOptions(componentId, options(props));
  }, componentId, [componentId]);
  useNavigationButtonPressed(({ buttonId }) => {
    if (currentCard) {
      if (buttonId === 'share') {
        const arkhamDbDomain = getArkhamDbDomain(getSystemLanguage());
        Linking.openURL(`${arkhamDbDomain}/card/${currentCard.code}#reviews-header`);
      } else if (buttonId === 'deck') {
        showInvestigatorCards(currentCard.code);
      } else if (buttonId === 'faq') {
        Navigation.push<CardFaqProps>(componentId, {
          component: {
            name: 'Card.Faq',
            passProps: {
              id: currentCard.code,
            },
            options: {
              topBar: {
                title: {
                  text: currentCard.name,
                },
                subtitle: {
                  text: t`FAQ`,
                },
              },
            },
          },
        });
      } else if (buttonId === 'investigator') {
        showInvestigators(currentCard.code);
      } else if (buttonId === 'back') {
        Navigation.pop(componentId);
      }
    }
  }, componentId, [currentCard, showInvestigators, showInvestigatorCards]);

  const showCardSpoiler = useCallback((card: Card) => {
    return !!(showAllSpoilers || showSpoilers[card.pack_code] || spoilers[card.code]);
  }, [showSpoilers, spoilers, showAllSpoilers]);
  const lockedPermanents = parsedDeck?.parsedDeck?.lockedPermanents;
  const slots = deckEdits?.slots;
  const [attachmentsForCard, investigatorAttachment] = useDeckAttachments(parsedDeck.parsedDeck?.investigator, slots);

  const deckCountControls = useMemo(() => {
    if (deckId === undefined || !currentCard) {
      return null;
    }
    if (currentControl === 'bonded') {
      return null;
    }
    const deck_limit: number = currentCard.collectionDeckLimit(packInCollection, ignore_collection);
    if (currentControl === 'attachment' && investigatorAttachment) {
      return (
        <FloatingDeckQuantityComponent
          code={currentCard.code}
          deckId={deckId}
          min={lockedPermanents?.[currentCard.code]}
          limit={deck_limit}
          mode={undefined}
          editable={editable}
          attachments={[investigatorAttachment]}
        />
      );
    }
    const attachments = attachmentsForCard(currentCard)
    return (
      <FloatingDeckQuantityComponent
        code={currentCard.code}
        deckId={deckId}
        min={lockedPermanents?.[currentCard.code]}
        limit={deck_limit}
        mode={(currentControl === 'side' || currentControl === 'extra' || currentControl === 'ignore' || currentControl === 'checklist') ? currentControl : undefined}
        editable={editable}
        attachments={attachments}
      />
    );
  }, [attachmentsForCard, investigatorAttachment, lockedPermanents, deckId, editable, currentCard, currentControl, packInCollection, ignore_collection]);
  const mode = deckEdits?.mode;
  const data: (Card | undefined)[] = useMemo(() => {
    return map(cardCodes, code => cards[code]);
  }, [cardCodes, cards]);

  const attachableCards = useAttachableCards();
  const renderCard = useCallback((
    { item: card, index: itemIndex }: {
      item: Card | undefined;
      index: number;
      animationValue?: Animated.SharedValue<number>;
    }
  ): React.ReactElement => {
    const attachment = card ? attachableCards[card.code] : undefined;
    const attachmentCards = attachment ? data.flatMap(c => c && !!find(attachment.traits, t => c?.real_traits_normalized?.indexOf(`#${t}#`) !== -1) ? [c] : []) : [];
    return (
      <ScrollableCard
        key={itemIndex}
        card={card}
        width={width}
        height={height}
        deckId={deckId}
        tabooSetId={tabooSetId}
        mode={mode}
        componentId={componentId}
        customizations={customizations}
        showCardSpoiler={showCardSpoiler}
        toggleShowSpoilers={toggleShowSpoilers}
        showInvestigatorCards={showInvestigatorCards}
        setChoice={setChoice}
        deckCount={card && slots?.[card.code]}
        customizationsEditable={editable || customizationsEditable}
        attachment={attachment}
        attachmentCards={attachmentCards}
      />
    );
  }, [attachableCards, data, slots, customizationsEditable, tabooSetId, editable, customizations, mode, componentId, deckId, width, height, setChoice, showCardSpoiler, toggleShowSpoilers, showInvestigatorCards]);
  return (
    <View
      style={[styles.wrapper, backgroundStyle, { width, height }]}
    >
      <SnapCarousel
        vertical={false}
        data={data}
        firstItem={initialIndex}
        inactiveSlideOpacity={1}
        initialNumToRender={data[initialIndex]?.type_code === 'investigator' ? 1 : 2}
        maxToRenderPerBatch={3}
        renderItem={renderCard}
        sliderWidth={width}
        itemWidth={width}
        useExperimentalSnap
        onScrollIndexChanged={setIndex}
        disableIntervalMomentum
        activeSlideOffset={5}
        shouldOptimizeUpdates
        apparitionDelay={Platform.OS === 'ios' ? 50 : undefined}
      />
      { !!parsedDeck && (
        <>
          <PreLoadedDeckNavFooter
            mode={currentControl === 'extra' ? 'extra' : undefined}
            componentId={componentId}
            parsedDeckObj={parsedDeck}
            control="counts"
            onPress={backPressed}
          />
          { deckCountControls }
        </>
      ) }
      { Platform.OS === 'ios' && <View style={[styles.gutter, { height }]} /> }
    </View>
  );
}

DbCardDetailSwipeView.options = options;

export default DbCardDetailSwipeView;


const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  gutter: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 10,
  },
});
